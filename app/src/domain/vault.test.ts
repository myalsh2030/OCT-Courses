import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITERATIONS,
  deriveEntryKey,
  fromBase64,
  importRecordKey,
  normalizeRef,
  normalizeTrainerNo,
  randomId,
  randomRecordKey,
  randomSalt,
  seal,
  sealBytes,
  toBase64,
  unseal,
  unsealBytes,
  type VaultParams,
} from './vault';

/**
 * التعمية تُختبر بالسلوك لا بالبنية: نطبّع كما يكتب المدرب رقمه، ونشتق
 * ونشفّر ونفكّ، ونتأكد أن كل طريق خاطئ ينتهي إلى `null` واحد لا إلى
 * رسالة تدل السائل على موضع خطئه.
 *
 * الدورات هنا ١٠٠٠ لا ٣١٠٬٠٠٠ — الاختبار يتحقق من صحة الاشتقاق لا من
 * كلفته، والكلفة الحقيقية تبقى في الحزم المنشورة.
 */

const PARAMS: VaultParams = { salt: toBase64(new Uint8Array(16).fill(7)), iterations: 1000 };

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe('تطبيع رقم المدرب', () => {
  it('الأصفار البادئة والفراغات وصيغ الإدخال المختلفة تعطي رقماً واحداً', () => {
    for (const input of ['13270', '013270', '0013270', ' 13270 ', '0013270\n', '13-270']) {
      expect(normalizeTrainerNo(input)).toBe('0013270');
    }
  });

  it('يُبطّن الأرقام القصيرة إلى سبع خانات', () => {
    expect(normalizeTrainerNo('607')).toBe('0000607');
    expect(normalizeTrainerNo('0000607')).toBe('0000607');
    expect(normalizeTrainerNo('5527')).toBe('0005527');
  });

  it('يقبل الأرقام العربية والفارسية كما ينسخها المدرب', () => {
    expect(normalizeTrainerNo('٠٠١٣٢٧٠')).toBe('0013270');
    expect(normalizeTrainerNo('۱۳۲۷۰')).toBe('0013270');
  });

  it('ما لا رقم فيه يعود فارغاً — «-» في التقرير شعبة بلا مدرب', () => {
    expect(normalizeTrainerNo('-')).toBe('');
    expect(normalizeTrainerNo('')).toBe('');
    expect(normalizeTrainerNo('  ')).toBe('');
  });

  it('لا يقتطع رقماً أطول من سبع خانات', () => {
    expect(normalizeTrainerNo('12345678')).toBe('12345678');
  });
});

describe('تطبيع الرقم المرجعي', () => {
  it('أرقام فقط بلا فراغات', () => {
    expect(normalizeRef(' 10630 ')).toBe('10630');
    expect(normalizeRef('10 630')).toBe('10630');
    expect(normalizeRef('١٠٦٣٠')).toBe('10630');
    expect(normalizeRef('ref:10630')).toBe('10630');
  });

  it('لا يحذف الأصفار البادئة — رقمان مختلفان يبقيان مختلفين', () => {
    expect(normalizeRef('010630')).toBe('010630');
    expect(normalizeRef('010630')).not.toBe(normalizeRef('10630'));
  });

  it('الفارغ يبقى فارغاً', () => {
    expect(normalizeRef('-')).toBe('');
  });
});

describe('اشتقاق مفتاح المدخل', () => {
  it('المعرّف بصمة ست عشرية من ٦٤ خانة', async () => {
    const { entryId } = await deriveEntryKey('0013270', '10630', PARAMS);
    expect(entryId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('الزوج نفسه يعطي المعرّف نفسه مهما اختلفت صيغة كتابته', async () => {
    const a = await deriveEntryKey('0013270', '10630', PARAMS);
    const b = await deriveEntryKey(' 13270 ', ' 10630 ', PARAMS);
    expect(b.entryId).toBe(a.entryId);
  });

  it('كل تغيّر في الزوج أو الملح أو الدورات يغيّر المعرّف', async () => {
    const base = await deriveEntryKey('0013270', '10630', PARAMS);
    const otherRef = await deriveEntryKey('0013270', '10631', PARAMS);
    const otherNo = await deriveEntryKey('0013271', '10630', PARAMS);
    const otherSalt = await deriveEntryKey('0013270', '10630', {
      salt: toBase64(new Uint8Array(16).fill(9)),
      iterations: PARAMS.iterations,
    });
    const otherRounds = await deriveEntryKey('0013270', '10630', { ...PARAMS, iterations: 999 });
    const ids = [base, otherRef, otherNo, otherSalt, otherRounds].map((k) => k.entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('المفتاح لا يُشتق من المعرّف — وجوده في الملف المنشور لا يفتح شيئاً', async () => {
    const { entryId, key } = await deriveEntryKey('0013270', '10630', PARAMS);
    const sealed = await seal(key, 'سجل المدرب');
    const idAsKey = await crypto.subtle.importKey(
      'raw',
      fromHex(entryId),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    expect(await unseal(idAsKey, sealed)).toBeNull();
    expect(await unseal(key, sealed)).toBe('سجل المدرب');
  });

  it('الدورات الافتراضية للحزم المنشورة ٣١٠٬٠٠٠', () => {
    expect(DEFAULT_ITERATIONS).toBe(310_000);
  });
});

describe('التشفير والفك', () => {
  it('دورة كاملة على نص عربي', async () => {
    const { key } = await deriveEntryKey('0013270', '10630', PARAMS);
    const text = JSON.stringify({ name: 'محمد الشبيلي', sections: ['مصيم-141'] });
    expect(await unseal(key, await seal(key, text))).toBe(text);
  });

  it('متجه تهيئة جديد لكل عملية: النص نفسه يعطي تشفيرتين مختلفتين تُفكّان معاً', async () => {
    const { key } = await deriveEntryKey('0013270', '10630', PARAMS);
    const first = await seal(key, 'سجل');
    const second = await seal(key, 'سجل');
    expect(first).not.toBe(second);
    expect(await unseal(key, first)).toBe('سجل');
    expect(await unseal(key, second)).toBe('سجل');
  });

  it('مفتاح آخر يعطي null لا استثناءً', async () => {
    const mine = await deriveEntryKey('0013270', '10630', PARAMS);
    const other = await deriveEntryKey('0005527', '10829', PARAMS);
    expect(await unseal(other.key, await seal(mine.key, 'سجل'))).toBeNull();
  });

  it('النص المشفّر المبتور أو المعبوث به أو الفاسد ترميزه كلها null', async () => {
    const { key } = await deriveEntryKey('0013270', '10630', PARAMS);
    const sealed = await seal(key, 'سجل المدرب كاملاً');
    const bytes = fromBase64(sealed);
    const tampered = Uint8Array.from(bytes);
    tampered[tampered.length - 1] ^= 0xff;

    expect(await unseal(key, toBase64(tampered))).toBeNull();
    expect(await unseal(key, toBase64(bytes.subarray(0, 8)))).toBeNull();
    expect(await unseal(key, 'ليس base64 أصلاً')).toBeNull();
    expect(await unseal(key, '')).toBeNull();
  });

  it('متجه التهيئة ملحق بأول النص المشفّر: طوله ١٢ بايت زائد النص والوسم', async () => {
    const { key } = await deriveEntryKey('0013270', '10630', PARAMS);
    const bytes = fromBase64(await seal(key, 'أب'));
    // «أب» أربعة بايتات UTF-8 + وسم GCM ١٦ بايت + متجه ١٢
    expect(bytes.length).toBe(12 + 4 + 16);
  });
});

describe('مفتاح السجل والمعرّف العشوائي', () => {
  it('مفتاح سجل عشوائي ٢٥٦ بتاً، جديد في كل نداء، يشفّر السجل ويفكّه', async () => {
    const first = await randomRecordKey();
    const second = await randomRecordKey();
    expect(first.raw).toHaveLength(32);
    expect(toBase64(first.raw)).not.toBe(toBase64(second.raw));

    const record = JSON.stringify({ trainerNo: '0013270', name: 'محمد الشبيلي' });
    const sealed = await seal(first.key, record);
    expect(await unseal(first.key, sealed)).toBe(record);
    expect(await unseal(second.key, sealed)).toBeNull();
  });

  it('المفتاح المستورد من المادة نفسها يفكّ ما شفّره صاحبه', async () => {
    const { key, raw } = await randomRecordKey();
    const sealed = await seal(key, 'سجل');
    expect(await unseal(await importRecordKey(raw), sealed)).toBe('سجل');
  });

  it('تغليف البايتات وفكّها: مفتاح السجل يعود كما هو، والمفتاح الخاطئ null', async () => {
    const { raw } = await randomRecordKey();
    const wrapper = await deriveEntryKey('0013270', '10630', PARAMS);
    const stranger = await deriveEntryKey('0005527', '10829', PARAMS);

    const wrapped = await sealBytes(wrapper.key, raw);
    const opened = await unsealBytes(wrapper.key, wrapped);
    expect(opened).toHaveLength(32);
    expect(toBase64(opened!)).toBe(toBase64(raw));
    expect(await unsealBytes(stranger.key, wrapped)).toBeNull();
    expect(await unsealBytes(wrapper.key, 'ليس base64 أصلاً')).toBeNull();
  });

  it('المعرّف العشوائي ٣٢ خانة ست عشرية ولا يتكرر', () => {
    const ids = Array.from({ length: 50 }, () => randomId());
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('الملح', () => {
  it('ملح جديد ١٦ بايت لكل نداء', () => {
    const first = randomSalt();
    const second = randomSalt();
    expect(fromBase64(first)).toHaveLength(16);
    expect(first).not.toBe(second);
  });
});
