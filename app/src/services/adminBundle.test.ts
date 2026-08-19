import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBundle, openBundle } from '../domain/bundle';
import { readSS01Rows, type SS01Row } from '../domain/ss01';
import { toBase64 } from '../domain/vault';
import type { TermEntry } from './bundleSource';
import {
  arabicLeaks,
  buildBundleChunked,
  buildTermPackage,
  countDerivations,
  guardPublishFiles,
  nextTermsManifest,
  type BuildProgress,
  type PackageFile,
} from './adminBundle';

/**
 * إنتاج الحزمة في المتصفح على العيّنة الحقيقية نفسها التي يختبرها
 * `domain/bundle.test.ts` (٤١ صفاً، ٦ مدربين، ٣١ شعبة مسندة، ٥ شعب بلا
 * مدرب). الدورات ١٠٠٠ والملح ثابت: المقصود صحة الدورة لا كلفتها.
 *
 * ما يحرسه هذا الملف ثلاثة:
 * 1. أن **التقطيع لا يغيّر الحزمة** — مداخل الحزمة المقطَّعة هي نفسها
 *    مداخل حزمةٍ بُنيت دفعة واحدة، والترتيب النهائي بالمعرّفات لا بالدفعات.
 * 2. أن **حارس الحرف العربي** يمنع الملف المتسرّب ويسمح بالنظيف.
 * 3. أن **أسماء الملفات والمانيفست** كما ينتظرها الموقع المنشور.
 */

const SAMPLE = readFileSync(join(__dirname, '../test/fixtures/SS01.144710.sample.csv'), 'utf-8');
const ROWS = readSS01Rows(SAMPLE).rows;
const OPTIONS = {
  term: '144710',
  iterations: 1000,
  salt: toBase64(new Uint8Array(16).fill(7)),
  chunkSize: 5,
  breathe: async () => {},
};

const TRAINER = '0013270';
const REFS = ['10630', '10631', '10638'];

/** صفٌّ مصطنع — لاختبار الحالات التي لا توجد في العيّنة. */
function row(fields: Partial<SS01Row>): SS01Row {
  return {
    term: '144710',
    department: 'التقنية الميكانيكية',
    rayatCode: 'مصيم-141',
    courseName: 'أساسيات ميكانيكا الموائع',
    ref: '10630',
    type: 'نظري صباحي',
    day: '',
    time: '',
    building: '',
    room: '',
    capacity: '',
    enrolled: '',
    remaining: '',
    trainerNo: '-',
    trainerName: '-',
    ...fields,
  };
}

describe('عدّ الاشتقاقات', () => {
  it('اشتقاقٌ لكل شعبة مسندة — لا لكل صف ولا للشعب الشاغرة', () => {
    expect(ROWS).toHaveLength(41);
    expect(countDerivations(ROWS)).toBe(31);
  });

  it('الشعبة بلقاءين لا تُحتسب مرتين', () => {
    const twice = [row({ trainerNo: '13270', trainerName: 'س', day: 'الأحد' }), row({ trainerNo: '13270', trainerName: 'س', day: 'الاثنين' })];
    expect(countDerivations(twice)).toBe(1);
  });

  it('الشعبة بلا مدرب لا اشتقاق لها', () => {
    expect(countDerivations([row({})])).toBe(0);
  });
});

describe('البناء على دفعات', () => {
  it('يبني حزمةً كاملة تُفتح بأي رقم مرجعي للمدرب', async () => {
    const bundle = await buildBundleChunked(ROWS, OPTIONS);

    expect(Object.keys(bundle.records)).toHaveLength(6);
    expect(Object.keys(bundle.entries)).toHaveLength(31);
    expect(bundle.term).toBe('144710');
    expect(bundle.iterations).toBe(1000);

    for (const ref of REFS) {
      const record = await openBundle(bundle, TRAINER, ref);
      expect(record?.trainerNo).toBe(TRAINER);
      expect(record?.sections).toHaveLength(3);
    }
    expect(await openBundle(bundle, TRAINER, '99999')).toBeNull();
  });

  it('مداخل الحزمة المقطَّعة هي مداخل حزمةٍ بُنيت دفعةً واحدة', async () => {
    const chunked = await buildBundleChunked(ROWS, OPTIONS);
    const whole = await buildBundle(ROWS, {
      term: OPTIONS.term,
      iterations: OPTIONS.iterations,
      salt: OPTIONS.salt,
    });
    expect(Object.keys(chunked.entries).sort()).toEqual(Object.keys(whole.entries).sort());
  });

  it('الترتيب النهائي بالمعرّفات لا بحدود الدفعات', async () => {
    const bundle = await buildBundleChunked(ROWS, { ...OPTIONS, chunkSize: 2 });
    const ids = Object.keys(bundle.entries);
    expect(ids).toEqual([...ids].sort());
    const records = Object.keys(bundle.records);
    expect(records).toEqual([...records].sort());
  });

  it('يبلّغ تقدّماً متزايداً ينتهي عند الإجمالي', async () => {
    const seen: BuildProgress[] = [];
    await buildBundleChunked(ROWS, { ...OPTIONS, onProgress: (p) => seen.push(p) });

    expect(seen.length).toBeGreaterThan(3);
    expect(seen[0]).toEqual({ done: 0, total: 31, percent: 0 });
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i].done).toBeGreaterThanOrEqual(seen[i - 1].done);
      expect(seen[i].total).toBe(31);
    }
    expect(seen.at(-1)).toEqual({ done: 31, total: 31, percent: 100 });
  });
});

describe('حارس الحرف العربي', () => {
  it('الحزمة المبنية لا تحوي حرفاً عربياً واحداً', async () => {
    const bundle = await buildBundleChunked(ROWS, OPTIONS);
    expect(arabicLeaks(JSON.stringify(bundle))).toEqual([]);
  });

  it('يلتقط الاسم العربي أينما كان', () => {
    expect(arabicLeaks('{"r":"م/ محمد يوسف"}')).not.toHaveLength(0);
    // أشكال العرض العربية (ﻻ) خارج النطاق الأساسي — والحارس يشملها
    expect(arabicLeaks('ﻻ')).toHaveLength(1);
    // ولا يُنذر كاذباً على base64 وست عشري وأرقام
    expect(arabicLeaks('aGVsbG8=+/09 3f8a90 {"version":2}')).toEqual([]);
  });

  it('يمنع الملف المتسرّب ويسمّيه', () => {
    const files: PackageFile[] = [
      { name: 'ss01-144710.enc.json', text: '{"records":{"a":"مدرب"}}', type: 'application/json' },
    ];
    const message = guardPublishFiles(files);
    expect(message).toContain('مُنع التنزيل');
    expect(message).toContain('ss01-144710.enc.json');
  });

  it('يسمح بالملف النظيف', () => {
    expect(
      guardPublishFiles([{ name: 'terms.json', text: '{"terms":[]}', type: 'application/json' }]),
    ).toBe('');
  });
});

describe('مانيفست الفصول', () => {
  const entry = (term: string): TermEntry => ({ term, builtAt: '', trainers: 1, sections: 1 });

  it('يُدخل الفصل الجديد ويرتّب الأحدث أولاً', () => {
    const terms = nextTermsManifest([entry('144620'), entry('144630')], entry('144710'));
    expect(terms.map((t) => t.term)).toEqual(['144710', '144630', '144620']);
  });

  it('إعادة بناء فصلٍ منشور تستبدله ولا تكرره', () => {
    const fresh = { ...entry('144710'), trainers: 87 };
    const terms = nextTermsManifest([entry('144710'), entry('144620')], fresh);
    expect(terms).toHaveLength(2);
    expect(terms[0].trainers).toBe(87);
  });
});

describe('حزمة الفصل كاملةً', () => {
  it('ملفّان باسميهما المعتمدين، ومانيفست يحمل أعداد الحزمة', async () => {
    const result = await buildTermPackage(ROWS, {
      ...OPTIONS,
      publishedTerms: [{ term: '144620', builtAt: '', trainers: 3, sections: 9 }],
      at: new Date('2026-08-20T08:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.files.map((f) => f.name)).toEqual(['ss01-144710.enc.json', 'terms.json']);
    expect(result.entry).toEqual({
      term: '144710',
      builtAt: '2026-08-20T08:00:00.000Z',
      trainers: 6,
      sections: 31,
    });

    const manifest = JSON.parse(result.files[1].text) as { terms: TermEntry[] };
    expect(manifest.terms.map((t) => t.term)).toEqual(['144710', '144620']);
    expect(manifest.terms[0].sections).toBe(31);

    // الملف كما يكتبه سكربت البناء: JSON ينتهي بسطر جديد
    expect(result.files[0].text.endsWith('\n')).toBe(true);
    expect(JSON.parse(result.files[0].text).term).toBe('144710');
  });

  it('تقريرٌ بلا مدرب مسند لا حزمة له', async () => {
    const result = await buildTermPackage([row({})], OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('لا مدرب مسند');
  });

  it('تقريرٌ بلا رقم فصل يُرفض قبل أي اشتقاق', async () => {
    const result = await buildTermPackage([row({ term: '', trainerNo: '13270' })], {
      iterations: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('رقم الفصل التدريبي');
  });
});
