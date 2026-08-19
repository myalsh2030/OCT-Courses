import { BUNDLE_VERSION, buildBundle, type BundleEntry, type VaultBundle } from '../domain/bundle';
import type { SS01Row } from '../domain/ss01';
import { readTerm } from '../domain/term';
import {
  DEFAULT_ITERATIONS,
  normalizeRef,
  normalizeTrainerNo,
  randomSalt,
} from '../domain/vault';
import { bundleFileName, type TermEntry } from './bundleSource';

/**
 * إنتاج حزمة الفصل داخل المتصفح — ما يفعله `scripts/build-bundle.ts` في
 * الطرفية، بثلاث زيادات تفرضها الشاشة:
 *
 * 1. **تقدّمٌ مرئي**: الحزمة الحقيقية ٥٤٥ اشتقاق PBKDF2 بثلاثمئة ألف دورة
 *    ≈ نصف دقيقة. `buildBundle` عمليةٌ واحدة لا تُخبر عن نفسها، فتُقطَّع
 *    هنا دفعاتٍ بمدربين كاملين: بعد كل دفعة تُبلَّغ النسبة ويُترك للمتصفح
 *    نبضةٌ يرسم فيها. القطع لا يغيّر الناتج ولا يبطّئه — `buildBundle`
 *    يمرّ على المدربين بالتتابع أصلاً، والتوازي داخل شعب المدرب الواحد
 *    كما هو.
 * 2. **حارس الحرف العربي**: حرفٌ عربي واحد في نص الحزمة يعني نصاً صريحاً
 *    تسرّب إليها، فيُمنع التنزيل. هذا آخر خط دفاع قبل مستودع عام.
 * 3. **مانيفست الفصول**: `terms.json` يُحدَّث ويُنزَّل مع الحزمة، وإلا
 *    نُشرت حزمةٌ لا يعرفها أحد.
 *
 * التعمية كلها من `domain/`؛ هذا الملف يقطّع ويجمّع ويتحقق لا غير.
 */

/* ───────────────────────── التقطيع والتقدّم ───────────────────────── */

export interface BuildProgress {
  /** اشتقاقات أُنجزت. */
  done: number;
  /** إجمالي الاشتقاقات المطلوبة = عدد الشعب المسندة. */
  total: number;
  /** نسبة مئوية صحيحة (٠–١٠٠). */
  percent: number;
}

export interface ChunkedBuildOptions {
  /** الفصل التدريبي؛ يُقرأ من الصفوف إن لم يُمرَّر. */
  term?: string;
  /** دورات PBKDF2 — تُخفَّض في الاختبارات وحدها. */
  iterations?: number;
  /** ملح ثابت للاختبار؛ الافتراضي ملح عشوائي جديد لكل حزمة. */
  salt?: string;
  onProgress?: (progress: BuildProgress) => void;
  /** حدّ اشتقاقات الدفعة قبل أن يلتقط المتصفح أنفاسه. */
  chunkSize?: number;
  /** فسحةٌ بين الدفعتين — تُستبدل في الاختبار بلا انتظار. */
  breathe?: () => Promise<void>;
}

/** الدفعة الافتراضية: نحو ثلاثين تبليغاً على تقرير ٥٤٥ شعبة. */
const DEFAULT_CHUNK = 18;

/** يترك الخيط الرئيسي يرسم قبل الدفعة التالية. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface TrainerGroup {
  rows: SS01Row[];
  /** عدد شعبه بلا تكرار = عدد اشتقاقاته. */
  derivations: number;
}

/**
 * صفوف كل مدرب مجموعةً على حدة. الصفوف بلا رقم مدرب أو بلا رقم مرجعي
 * تُترك — `collectTrainers` يتركها كذلك، فلا سجل لها في الحزمة أصلاً.
 */
function groupByTrainer(rows: SS01Row[]): TrainerGroup[] {
  const groups = new Map<string, TrainerGroup>();
  const seenRefs = new Map<string, Set<string>>();

  for (const row of rows) {
    const trainerNo = normalizeTrainerNo(row.trainerNo);
    const ref = normalizeRef(row.ref);
    if (!trainerNo || !ref) continue;

    let group = groups.get(trainerNo);
    if (!group) {
      group = { rows: [], derivations: 0 };
      groups.set(trainerNo, group);
      seenRefs.set(trainerNo, new Set());
    }
    group.rows.push(row);

    const refs = seenRefs.get(trainerNo)!;
    if (!refs.has(ref)) {
      refs.add(ref);
      group.derivations += 1;
    }
  }
  return [...groups.values()];
}

/** عدد اشتقاقات PBKDF2 التي سيتطلبها بناء الحزمة = عدد الشعب المسندة. */
export function countDerivations(rows: SS01Row[]): number {
  return groupByTrainer(rows).reduce((sum, group) => sum + group.derivations, 0);
}

/**
 * يبني حزمة الفصل على دفعات ويبلّغ التقدّم بعد كل دفعة.
 *
 * الدفعات تتقاسم الملح والدورات والفصل، فناتجها حزمةٌ واحدة لا فرق بينها
 * وبين حزمة `buildBundle` على الصفوف كلها. والمداخل والسجلات تُعاد ترتيبها
 * بمعرّفاتها العشوائية في النهاية، فلا يبقى في الملف أثرٌ لحدود الدفعات:
 * الترتيب لا يقول إن هذه المداخل الثمانية عشر لمدربين متجاورين.
 */
export async function buildBundleChunked(
  rows: SS01Row[],
  options: ChunkedBuildOptions = {},
): Promise<VaultBundle> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const salt = options.salt ?? randomSalt();
  const term = readTerm(options.term || rows.find((r) => r.term)?.term || '').code;
  const limit = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK);
  const breathe = options.breathe ?? tick;

  const groups = groupByTrainer(rows);
  const total = groups.reduce((sum, group) => sum + group.derivations, 0);
  options.onProgress?.({ done: 0, total, percent: 0 });

  const records: [string, string][] = [];
  const entries: [string, BundleEntry][] = [];
  let done = 0;
  let batch: SS01Row[] = [];
  let batchSize = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const partial = await buildBundle(batch, { term, iterations, salt });
    records.push(...Object.entries(partial.records));
    entries.push(...Object.entries(partial.entries));
    done += batchSize;
    batch = [];
    batchSize = 0;
    options.onProgress?.({
      done,
      total,
      percent: total === 0 ? 100 : Math.round((done / total) * 100),
    });
    await breathe();
  };

  for (const group of groups) {
    batch.push(...group.rows);
    batchSize += group.derivations;
    if (batchSize >= limit) await flush();
  }
  await flush();

  const byId = (a: [string, unknown], b: [string, unknown]) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  records.sort(byId);
  entries.sort(byId);

  return {
    version: BUNDLE_VERSION,
    term,
    salt,
    iterations,
    records: Object.fromEntries(records),
    entries: Object.fromEntries(entries),
  };
}

/* ───────────────────────── حارس الحرف العربي ───────────────────────── */

/**
 * الحروف العربية بكل نطاقاتها (الأساسي، والمكمّل، والممتد، وأشكال العرض).
 * السكربت يفحص النطاق الأساسي وحده؛ هنا نطاقٌ أوسع لأن الملف يُنشر من
 * المتصفح مباشرة، ونصُّ الحزمة base64 وست عشري فلا يحتمل توسيعُ النطاق
 * إنذاراً كاذباً.
 */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

/** الحروف العربية الموجودة في نصٍّ يُنشر — الفارغ يعني نظيفاً. */
export function arabicLeaks(text: string): string[] {
  return text.match(ARABIC) ?? [];
}

/**
 * الحارس الأخير قبل التنزيل: يفحص كل ملف ذاهبٍ إلى المستودع العام،
 * ويعيد رسالة المنع أو نصاً فارغاً. حرفٌ عربي واحد يكفي للمنع — الحزمة
 * كلها base64 وست عشري، فظهور حرفٍ عربي ليس احتمالاً بل دليل تسرّب.
 */
export function guardPublishFiles(files: PackageFile[]): string {
  for (const file of files) {
    const leaks = arabicLeaks(file.text);
    if (leaks.length > 0) {
      return (
        `مُنع التنزيل: «${file.name}» يحوي ${leaks.length} حرفاً عربياً — ` +
        `أي أن نصاً صريحاً تسرّب إلى ملفٍ يُنشر (أوّله «${leaks.slice(0, 12).join('')}»). ` +
        'لا تنشر هذا الملف، وراجع بناء الحزمة.'
      );
    }
  }
  return '';
}

/* ───────────────────────── الحزمة كاملةً ───────────────────────── */

export interface PackageFile {
  name: string;
  text: string;
  type: string;
}

export interface PackageOptions extends ChunkedBuildOptions {
  /** مانيفست الفصول المنشور حالياً — تُدمج فيه الحزمة الجديدة. */
  publishedTerms?: TermEntry[];
  at?: Date;
}

export type PackageResult =
  | {
      ok: true;
      bundle: VaultBundle;
      /** ملفّا النشر: حزمة الفصل ومانيفست الفصول. */
      files: PackageFile[];
      entry: TermEntry;
      seconds: number;
    }
  | { ok: false; message: string };

/** مانيفست الفصول بعد إدخال الفصل المبني، الأحدث أولاً. */
export function nextTermsManifest(published: TermEntry[], entry: TermEntry): TermEntry[] {
  return [...published.filter((t) => t.term !== entry.term), entry].sort((a, b) =>
    b.term.localeCompare(a.term, undefined, { numeric: true }),
  );
}

/**
 * يبني حزمة الفصل ومانيفستها ويتحقق منهما قبل التسليم للتنزيل.
 *
 * الفشل رسالةٌ عربية لا استثناء: الأدمن لا يفتح الطرفية ليقرأ ما جرى.
 */
export async function buildTermPackage(
  rows: SS01Row[],
  options: PackageOptions = {},
): Promise<PackageResult> {
  const term = readTerm(options.term || rows.find((r) => r.term)?.term || '').code;
  if (!term) {
    return { ok: false, message: 'لم يُعثر على رقم الفصل التدريبي في التقرير — لا حزمة تُبنى.' };
  }
  if (countDerivations(rows) === 0) {
    return { ok: false, message: 'لا مدرب مسند في هذا التقرير — لا حزمة تُبنى.' };
  }

  const startedAt = Date.now();
  const bundle = await buildBundleChunked(rows, { ...options, term });
  const seconds = (Date.now() - startedAt) / 1000;

  const entry: TermEntry = {
    term,
    builtAt: (options.at ?? new Date()).toISOString(),
    trainers: Object.keys(bundle.records).length,
    sections: Object.keys(bundle.entries).length,
  };

  const terms = nextTermsManifest(options.publishedTerms ?? [], entry);
  const files: PackageFile[] = [
    {
      name: bundleFileName(term),
      text: `${JSON.stringify(bundle)}\n`,
      type: 'application/json',
    },
    {
      name: 'terms.json',
      text: `${JSON.stringify({ terms }, null, 1)}\n`,
      type: 'application/json',
    },
  ];

  const blocked = guardPublishFiles(files);
  if (blocked) return { ok: false, message: blocked };

  return { ok: true, bundle, files, entry, seconds };
}
