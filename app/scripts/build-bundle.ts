/**
 * يبني حزمة فصلٍ معمّاة من تقرير رايات SS01 ويحدّث مانيفست الفصول.
 *
 * التشغيل:
 *   node scripts/run-ts.mjs scripts/build-bundle.ts <مسار التقرير.csv>
 *   npm run data:bundle -- <مسار التقرير.csv>
 *
 * المخرجات في `public/data/`:
 *   - `ss01-<الفصل>.enc.json` حزمة الفصل (سجل كل مدرب مشفَّراً مرة واحدة،
 *      ومدخلٌ صغير لكل زوج «رقم مدرب + رقم مرجعي»).
 *   - `terms.json` قائمة الفصول المنشورة، الأحدث أولاً.
 *
 * الملف الناتج لا يحمل اسماً ولا رقماً ظاهراً — يُتحقق من ذلك هنا قبل
 * الكتابة: أي حرف عربي في الحزمة يعني تسرّب نصٍّ صريح، فيُرفض البناء.
 *
 * التعمية كلها من `domain/vault.ts` و`domain/bundle.ts` — هذا السكربت
 * يقرأ ويكتب ولا يعرف التشفير.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildBundle, collectTrainers } from '../src/domain/bundle';
import { readSS01Rows } from '../src/domain/ss01';
import { readTerm } from '../src/domain/term';

const ROOT = resolve(process.cwd());
const OUT_DIR = resolve(ROOT, 'public/data');
const MANIFEST = resolve(OUT_DIR, 'terms.json');

interface TermEntry {
  term: string;
  builtAt: string;
  trainers: number;
  sections: number;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const source = process.argv[2];
if (!source) {
  fail('مرّر مسار تقرير SS01 (CSV):\n   npm run data:bundle -- <مسار الملف.csv>');
}

const csvPath = resolve(source);
if (!existsSync(csvPath)) fail(`لا يوجد ملف على المسار: ${csvPath}`);

const read = readSS01Rows(readFileSync(csvPath, 'utf-8'));
if (!read.ok) fail(read.message ?? 'تعذّر قراءة التقرير.');

const term = readTerm(read.term).code;
if (!term) fail('لم يُعثر على رقم الفصل التدريبي في التقرير.');

const records = collectTrainers(read.rows);
const sections = records.reduce((sum, r) => sum + r.sections.length, 0);
if (records.length === 0) fail('لا مدرب مسند في هذا التقرير — لا حزمة تُبنى.');

console.log(`قراءة ${basename(csvPath)}: ${read.rows.length} صفاً`);
console.log(`الفصل ${term} — ${readTerm(term).label}`);
console.log(`${records.length} مدرباً، ${sections} شعبة مسندة`);
console.log('يُشتق مفتاحٌ لكل شعبة (PBKDF2 ٣١٠ ألف دورة)؛ قد يستغرق دقيقة أو أكثر…');

const startedAt = Date.now();
const bundle = await buildBundle(read.rows, { term });
const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

const json = JSON.stringify(bundle);
// حارس التعمية: حرفٌ عربي واحد في الحزمة = نصٌّ صريح تسرّب إليها
const leaked = json.match(/[؀-ۿ]/g);
if (leaked) fail(`الحزمة تحوي ${leaked.length} حرفاً عربياً — يوجد نصٌّ غير مشفَّر.`);

mkdirSync(OUT_DIR, { recursive: true });
const bundlePath = resolve(OUT_DIR, `ss01-${term}.enc.json`);
writeFileSync(bundlePath, `${json}\n`, 'utf8');

const entry: TermEntry = {
  term,
  builtAt: new Date().toISOString(),
  trainers: Object.keys(bundle.records).length,
  sections: Object.keys(bundle.entries).length,
};

/** يقرأ المانيفست القائم، أو يستنتجه من الحزم الموجودة إن كان مفقوداً. */
function currentTerms(): TermEntry[] {
  if (existsSync(MANIFEST)) {
    try {
      const parsed = JSON.parse(readFileSync(MANIFEST, 'utf-8')) as { terms?: TermEntry[] };
      if (Array.isArray(parsed.terms)) return parsed.terms;
    } catch {
      console.warn('! terms.json غير صالح — يُعاد بناؤه من الحزم الموجودة.');
    }
  }
  return readdirSync(OUT_DIR)
    .map((name) => /^ss01-(\d+)\.enc\.json$/.exec(name)?.[1])
    .filter((t): t is string => Boolean(t))
    .map((t) => ({ term: t, builtAt: '', trainers: 0, sections: 0 }));
}

const terms = [...currentTerms().filter((t) => t.term !== term), entry].sort((a, b) =>
  b.term.localeCompare(a.term, undefined, { numeric: true }),
);
writeFileSync(MANIFEST, `${JSON.stringify({ terms }, null, 1)}\n`, 'utf8');

const kb = (json.length / 1024).toFixed(0);
console.log(`✓ ${bundlePath.replace(ROOT, '.')} — ${kb} ك.ب في ${seconds} ثانية`);
console.log(`✓ ${MANIFEST.replace(ROOT, '.')} — ${terms.map((t) => t.term).join('، ')}`);
