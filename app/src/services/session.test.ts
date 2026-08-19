import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBundle, type VaultBundle } from '../domain/bundle';
import { readSS01Rows } from '../domain/ss01';
import { toBase64 } from '../domain/vault';
import { installSessionStorage } from '../test/sessionStorage';
import {
  assignedRayatCodes,
  clearSession,
  readSession,
  saveSession,
  SIGN_IN_FAILED,
  signIn,
} from './session';

/**
 * دخول المدرب على حزمةٍ حقيقية مبنيّة من عيّنة تقرير الفصل 144710.
 *
 * الدورات ١٠٠٠ لا ٣١٠٬٠٠٠ والملح ثابت: المختبَر صحّة الدورة لا كلفتها.
 * المهم هنا شيئان: أن التطبيع يقبل الرقم كما اعتاده المدرب لا كما يكتبه
 * رايات، وأن الفشل **رسالة واحدة** مهما كان سببه.
 */

const SAMPLE = readFileSync(join(__dirname, '../test/fixtures/SS01.144710.sample.csv'), 'utf-8');
const ROWS = readSS01Rows(SAMPLE).rows;
const TERM = '144710';

let bundle: VaultBundle;

beforeEach(async () => {
  installSessionStorage();
  bundle ??= await buildBundle(ROWS, {
    term: TERM,
    iterations: 1000,
    salt: toBase64(new Uint8Array(16).fill(7)),
  });
});

describe('تطبيع رقمَي الدخول', () => {
  const forms = [
    ['كما يكتبه رايات', '0013270', '10630'],
    ['بلا أصفار بادئة', '13270', '10630'],
    ['بصفرٍ واحد', '013270', '10630'],
    ['بفراغات حوله', '  13270  ', ' 10630 '],
    ['بأرقام هندية', '١٣٢٧٠', '١٠٦٣٠'],
    ['برقم مرجعي آخر من شعبه', '13270', '10638'],
  ] as const;

  for (const [label, no, ref] of forms) {
    it(`يفتح السجل نفسه — ${label}`, async () => {
      const result = await signIn(bundle, TERM, no, ref);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.session.trainerNo).toBe('0013270');
      expect(result.session.term).toBe(TERM);
      expect(result.session.record.sections.length).toBeGreaterThan(0);
    });
  }

  it('أي رقم مرجعي من شعبه يفتح سجله كاملاً — فلا يحفظ رقماً بعينه', async () => {
    const first = await signIn(bundle, TERM, '13270', '10630');
    const other = await signIn(bundle, TERM, '13270', '10638');
    expect(first.ok && other.ok).toBe(true);
    if (!first.ok || !other.ok) return;
    expect(other.session.record.sections).toEqual(first.session.record.sections);
  });
});

describe('فشل الدخول لا يتفرّع', () => {
  const cases = [
    ['رقم مدرب غير موجود', '9998887', '10630'],
    ['رقم مرجعي لمدرب آخر', '13270', '10829'],
    ['رقمان خاطئان', '9998887', '99999'],
    ['حقل فارغ', '', '10630'],
    ['حروف لا أرقام', 'مدرب', 'شعبة'],
  ] as const;

  for (const [label, no, ref] of cases) {
    it(`رسالةٌ واحدة — ${label}`, async () => {
      const result = await signIn(bundle, TERM, no, ref);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toBe(SIGN_IN_FAILED);
    });
  }

  it('الرسالة لا تدّعي معرفة أيّ الرقمين أخطأ', () => {
    expect(SIGN_IN_FAILED).not.toMatch(/غير مسجل|غير موجود|لا يطابق/);
  });

  it('حزمةٌ تالفة تُعامَل كفشلٍ لا كانهيار', async () => {
    const result = await signIn({ version: 2 }, TERM, '13270', '10630');
    expect(result.ok).toBe(false);
  });
});

describe('حفظ الجلسة في المتصفح', () => {
  it('تُحفظ وتُقرأ كما هي', async () => {
    const result = await signIn(bundle, TERM, '13270', '10630');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    saveSession(result.session);
    expect(readSession()).toEqual(result.session);
  });

  it('الخروج يمسحها', async () => {
    const result = await signIn(bundle, TERM, '13270', '10630');
    if (!result.ok) throw new Error('تعذّر بناء جلسة الاختبار');
    saveSession(result.session);
    clearSession();
    expect(readSession()).toBeNull();
  });

  it('جلسةٌ تالفة تُمسح ويُعامَل صاحبها كخارج', () => {
    globalThis.sessionStorage.setItem('oct.trainer.session', '{ليس JSON');
    expect(readSession()).toBeNull();
    expect(globalThis.sessionStorage.getItem('oct.trainer.session')).toBeNull();
  });

  it('جلسةٌ بشكلٍ غير متوقَّع لا تُقبل', () => {
    globalThis.sessionStorage.setItem('oct.trainer.session', JSON.stringify({ trainerNo: '1' }));
    expect(readSession()).toBeNull();
  });
});

describe('رموز المقررات المسندة', () => {
  it('بلا تكرار وبترتيب ورودها', async () => {
    const result = await signIn(bundle, TERM, '13270', '10630');
    if (!result.ok) throw new Error('تعذّر بناء جلسة الاختبار');
    const codes = assignedRayatCodes(result.session.record);
    expect(codes).toEqual([...new Set(codes)]);
    expect(codes.every((c) => c.includes('-'))).toBe(true);
  });
});
