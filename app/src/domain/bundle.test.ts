import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUNDLE_VERSION,
  buildBundle,
  collectTrainers,
  diffBundle,
  openBundle,
  type VaultBundle,
} from './bundle';
import { readSS01Rows, type SS01Row } from './ss01';
import { deriveEntryKey, importRecordKey, toBase64, unseal, unsealBytes } from './vault';

/**
 * الحزمة تُختبر على عيّنة من تقرير حقيقي (فصل 144710) منسوخة إلى
 * `test/fixtures` — لا على نص مصطنع ولا على الملف الأصلي في القرص:
 * فيها شعبة بلقاءين، وشعبة بقاعتين، وشعب بلا مدرب، وخمسة أقسام.
 *
 * الدورات ١٠٠٠ لا ٣١٠٬٠٠٠، والملح ثابت — الاختبار يتحقق من صحة الدورة
 * لا من كلفتها، وثبات الملح يمنع تعلّق النتيجة بعشوائية.
 */

const SAMPLE = readFileSync(
  join(__dirname, '../test/fixtures/SS01.144710.sample.csv'),
  'utf-8',
);

const read = readSS01Rows(SAMPLE);
const ROWS = read.rows;
const OPTIONS = { term: '144710', iterations: 1000, salt: toBase64(new Uint8Array(16).fill(7)) };

/** المدرب المرجعي في هذا الفصل: ثلاث شعب بثلاثة أرقام مرجعية. */
const TRAINER = '0013270';
const REFS = ['10630', '10631', '10638'];

describe('قراءة العيّنة', () => {
  it('تُقرأ كاملة بقارئ SS01 نفسه', () => {
    expect(read.ok).toBe(true);
    expect(read.term).toBe('144710');
    expect(ROWS).toHaveLength(41);
  });
});

describe('تجميع سجلات المدربين', () => {
  const records = collectTrainers(ROWS);

  it('سجل واحد لكل مدرب، والشعب بلا مدرب لا سجل لها', () => {
    expect(records).toHaveLength(6);
    expect(records.map((r) => r.trainerNo)).toEqual([
      '0000607',
      '0005527',
      '0009175',
      '0009764',
      '0012449',
      TRAINER,
    ]);
    // خمس شعب في العيّنة بلا مدرب («-» في التقرير) فلا تظهر في أي سجل
    const refs = records.flatMap((r) => r.sections.map((s) => s.ref));
    for (const orphan of ['64442', '71136', '10594', '10596', '10570']) {
      expect(refs).not.toContain(orphan);
    }
  });

  it('سجل المدرب يضم اسمه ورقمه وقسمه وكل شعبه', () => {
    const record = records.find((r) => r.trainerNo === TRAINER)!;
    expect(record.trainerName).toBe('محمد الشبيلي');
    expect(record.department).toBe('التقنية الميكانيكية');
    expect(record.term).toBe('144710');
    expect(record.sections.map((s) => s.ref)).toEqual(REFS);

    const theory = record.sections[0];
    expect(theory.rayatCode).toBe('مصيم-141');
    expect(theory.courseName).toBe('اساسيات ميكانيكا الموائع');
    expect(theory.type).toBe('نظري صباحي');
    expect(theory.meetings).toEqual([
      {
        day: 'الخميس',
        time: '1055 - 0915',
        building: 'مبنى الدراسات العامة',
        room: '1350610117',
      },
    ]);
    expect(theory).toMatchObject({ capacity: 10, enrolled: 8, remaining: 2 });
  });

  it('الشعبة الملتقية في يومين أو قاعتين تُجمع في شعبة واحدة بلقاءين', () => {
    const twoDays = records
      .flatMap((r) => r.sections)
      .find((s) => s.ref === '10776')!;
    expect(twoDays.meetings).toHaveLength(2);
    expect(new Set(twoDays.meetings.map((m) => m.day)).size).toBe(2);

    const twoRooms = records.flatMap((r) => r.sections).find((s) => s.ref === '63760')!;
    expect(twoRooms.meetings).toHaveLength(2);
    expect(new Set(twoRooms.meetings.map((m) => m.room)).size).toBe(2);
  });

  it('صفوف اللقاء المتكررة لا تكرر الشعبة ولا اللقاء', () => {
    for (const record of records) {
      const refs = record.sections.map((s) => s.ref);
      expect(new Set(refs).size).toBe(refs.length);
      for (const section of record.sections) {
        const keys = section.meetings.map((m) => `${m.day}|${m.time}|${m.room}`);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });
});

describe('دورة الحزمة كاملة', () => {
  it('يُبنى ملف الفصل بترويسته ومداخله', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    expect(bundle.version).toBe(BUNDLE_VERSION);
    expect(bundle.term).toBe('144710');
    expect(bundle.iterations).toBe(1000);
    // مدخل لكل شعبة مسندة (٣٦ شعبة في العيّنة، خمس منها بلا مدرب)
    expect(Object.keys(bundle.entries)).toHaveLength(31);
    // وسجل واحد لكل مدرب مهما تعددت شعبه
    expect(Object.keys(bundle.records)).toHaveLength(6);
  });

  it('الزوج الصحيح يعيد سجل المدرب نفسه الذي بُني منه', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const expected = collectTrainers(ROWS).find((r) => r.trainerNo === TRAINER)!;
    expect(await openBundle(bundle, TRAINER, '10630')).toEqual(expected);
  });

  it('كل أرقامه المرجعية تفتح السجل نفسه كاملاً', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const opened = await Promise.all(REFS.map((ref) => openBundle(bundle, TRAINER, ref)));
    expect(opened[0]).not.toBeNull();
    expect(opened[1]).toEqual(opened[0]);
    expect(opened[2]).toEqual(opened[0]);
    expect(opened[0]!.sections).toHaveLength(3);
  });

  it('يفتح بالرقم كما يكتبه المدرب: بلا أصفار بادئة أو بأرقام عربية', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const expected = await openBundle(bundle, TRAINER, '10630');
    expect(await openBundle(bundle, '13270', ' 10630 ')).toEqual(expected);
    expect(await openBundle(bundle, '١٣٢٧٠', '١٠٦٣٠')).toEqual(expected);
  });

  it('ملح جديد لكل حزمة، فحزمتان من الصفوف نفسها لا تتشابه مداخلهما', async () => {
    const first = await buildBundle(ROWS, { term: '144710', iterations: 1000 });
    const second = await buildBundle(ROWS, { term: '144710', iterations: 1000 });
    expect(first.salt).not.toBe(second.salt);
    expect(Object.keys(first.entries)).not.toEqual(Object.keys(second.entries));
    expect(await openBundle(second, TRAINER, '10638')).not.toBeNull();
  });
});

describe('الزوج الخاطئ لا يفتح ولا يفرّق', () => {
  it('رقم مدرب خاطئ، ورقم مرجعي لا يطابقه، وشعبة بلا مدرب: كلها null', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    // رقم مدرب غير موجود، ورقم مرجعي صحيح لمدرب آخر، ورقم مرجعي غير موجود
    expect(await openBundle(bundle, '0009999', '10630')).toBeNull();
    expect(await openBundle(bundle, TRAINER, '10829')).toBeNull();
    expect(await openBundle(bundle, TRAINER, '99999')).toBeNull();
    // شعبة بلا مدرب في التقرير — لا مدخل لها أصلاً
    expect(await openBundle(bundle, TRAINER, '10594')).toBeNull();
    expect(await openBundle(bundle, '', '10630')).toBeNull();
    expect(await openBundle(bundle, TRAINER, '')).toBeNull();
  });

  it('رقم مرجعي لمدرب آخر لا يفتح إلا سجل صاحبه', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const other = await openBundle(bundle, '0005527', '10829');
    expect(other!.trainerNo).toBe('0005527');
    expect(await openBundle(bundle, '0005527', '10630')).toBeNull();
  });

  it('حزمة تالفة أو مبدَّلة المداخل تعيد null لا استثناءً', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    expect(await openBundle({ nothing: true }, TRAINER, '10630')).toBeNull();
    expect(await openBundle(null, TRAINER, '10630')).toBeNull();
    expect(await openBundle({ ...bundle, salt: 'ملح غير صالح' }, TRAINER, '10630')).toBeNull();

    // نصّ مدخلٍ آخر يُوضع مكان مدخل المدرب: المفتاح صحيح والنص ليس له
    const mine = await deriveEntryKey(TRAINER, '10630', OPTIONS);
    const stranger = Object.entries(bundle.entries).find(([id]) => id !== mine.entryId)!;
    const swapped: VaultBundle = { ...bundle, entries: { ...bundle.entries } };
    swapped.entries[mine.entryId] = stranger[1];
    expect(await openBundle(swapped, TRAINER, '10630')).toBeNull();
  });
});

describe('حارس التعمية: الملف المنشور لا يحمل شيئاً مقروءاً', () => {
  it('لا اسم ولا مقرر ولا قسم — ولا حرف عربي واحد في الملف كله', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const text = JSON.stringify(bundle);

    for (const row of ROWS) {
      for (const secret of [row.trainerName, row.courseName, row.rayatCode, row.department]) {
        if (secret && secret !== '-') expect(text).not.toContain(secret);
      }
    }
    // الحسم: النص المسلسل ASCII خالص (بصمات ست عشرية وbase64)، فلا موضع لعربية
    expect(text).not.toMatch(/[؀-ۿ]/);
  });

  it('لا رقم مدرب ولا رقم مرجعي: بصمات ومعرّفات عشوائية وbase64، والغلاف لا يحمل سواهما', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
    for (const [entryId, entry] of Object.entries(bundle.entries)) {
      expect(entryId).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.r).toMatch(/^[0-9a-f]{32}$/);
      expect(entry.k).toMatch(BASE64);
      expect(Object.keys(bundle.records)).toContain(entry.r);
      expect(Object.keys(entry)).toEqual(['r', 'k']); // لا حقل ثالث يقول شيئاً
    }
    for (const [recordId, payload] of Object.entries(bundle.records)) {
      expect(recordId).toMatch(/^[0-9a-f]{32}$/);
      expect(payload).toMatch(BASE64);
    }
    // ما عدا المداخل المعمّاة لا يحمل الملف إلا الفصل والملح والدورات
    const envelope = JSON.stringify({
      version: bundle.version,
      term: bundle.term,
      salt: bundle.salt,
      iterations: bundle.iterations,
    });
    for (const row of ROWS) {
      if (row.trainerNo !== '-') {
        expect(envelope).not.toContain(row.trainerNo);
        expect(envelope).not.toContain(row.trainerNo.replace(/^0+/, ''));
      }
      expect(envelope).not.toContain(row.ref);
    }
  });

  it('لا ترتيب يدل: المداخل والسجلات مرتّبة بمعرّفاتها، ولا مدخلان متطابقان', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    for (const ids of [Object.keys(bundle.entries), Object.keys(bundle.records)]) {
      expect(ids).toEqual([...ids].sort());
    }
    // ثلاث شعب لمدرب واحد تحمل مفتاح سجل واحد، ومع ذلك لا تتشابه أغلفته
    const wrapped = Object.values(bundle.entries).map((e) => e.k);
    expect(new Set(wrapped).size).toBe(wrapped.length);
    const sealedRecords = Object.values(bundle.records);
    expect(new Set(sealedRecords).size).toBe(sealedRecords.length);
  });

  it('معرّف السجل عشوائي لا يُشتق من المدرب: حزمتان بالملح نفسه لا تتفقان فيه', async () => {
    const first = await buildBundle(ROWS, OPTIONS);
    const second = await buildBundle(ROWS, OPTIONS);
    // البصمات مشتقة فتثبت مع ثبات الملح…
    expect(Object.keys(second.entries)).toEqual(Object.keys(first.entries));
    // …ومعرّفات السجلات عشوائية فلا يتكرر منها واحد
    const before = new Set(Object.keys(first.records));
    expect(Object.keys(second.records).filter((id) => before.has(id))).toHaveLength(0);
  });

  it('عدد المداخل عدد الشعب، وعدد السجلات عدد المدربين — ولا يكشف الملف سواهما', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const records = collectTrainers(ROWS);
    const sections = records.reduce((n, r) => n + r.sections.length, 0);
    expect(Object.keys(bundle.entries)).toHaveLength(sections);
    expect(Object.keys(bundle.records)).toHaveLength(records.length);
    expect(sections).toBeGreaterThan(records.length);
  });
});

describe('التخزين على مستويين', () => {
  it('مفتاح زوج مدرب لا يفكّ غلاف مفتاح سجل مدرب آخر', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const mine = await deriveEntryKey(TRAINER, '10630', OPTIONS);
    const stranger = await deriveEntryKey('0005527', '10829', OPTIONS);

    // بمفتاحه هو: مفتاح سجل ٣٢ بايت يفكّ سجله
    const recordKeyBytes = await unsealBytes(mine.key, bundle.entries[mine.entryId].k);
    expect(recordKeyBytes).toHaveLength(32);
    const recordKey = await importRecordKey(recordKeyBytes!);
    expect(await unseal(recordKey, bundle.records[bundle.entries[mine.entryId].r])).toContain(
      TRAINER,
    );

    // وبمفتاحه على غلاف غيره: لا شيء، والعكس كذلك
    expect(await unsealBytes(mine.key, bundle.entries[stranger.entryId].k)).toBeNull();
    expect(await unsealBytes(stranger.key, bundle.entries[mine.entryId].k)).toBeNull();
    // ومفتاح سجله لا يفكّ سجل غيره وإن وصل إليه
    expect(await unseal(recordKey, bundle.records[bundle.entries[stranger.entryId].r])).toBeNull();
  });

  it('كل أرقام المدرب المرجعية تشير إلى معرّف السجل نفسه', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const keys = await Promise.all(REFS.map((ref) => deriveEntryKey(TRAINER, ref, OPTIONS)));
    const recordIds = keys.map(({ entryId }) => bundle.entries[entryId].r);
    expect(new Set(recordIds).size).toBe(1);

    const stranger = await deriveEntryKey('0005527', '10829', OPTIONS);
    expect(bundle.entries[stranger.entryId].r).not.toBe(recordIds[0]);
  });

  it('الحزمة أصغر من نظيرها لو كُرِّر السجل تحت كل رقم مرجعي — حارس انحدار', async () => {
    const bundle = await buildBundle(ROWS, OPTIONS);
    const size = JSON.stringify(bundle).length;
    // النظير المكرر: نص السجل المشفّر نفسه يتكرر مع كل مدخل بدل مفتاح مغلّف
    const repeated = Object.values(bundle.entries).reduce(
      (n, entry) => n + bundle.records[entry.r].length,
      0,
    );
    expect(size).toBeLessThan(repeated / 2);
  });
});

/* ───────────────────────── فروق الرفع ───────────────────────── */

const REF_DROPPED = '10638'; // شعبة تُحذف من الرفع الجديد
const REF_MOVED = '10630'; // شعبة يتغيّر مدربها
const REF_ORPHAN = '10594'; // شعبة بلا مدرب يُسند لها مدرب
const REF_NEW = '99001'; // شعبة لم تكن موجودة

function nextRows(): SS01Row[] {
  const changed = ROWS.filter((r) => r.ref !== REF_DROPPED).map((r) => {
    if (r.ref === REF_ORPHAN) return { ...r, trainerNo: '0005527', trainerName: 'خالد الواصل' };
    if (r.ref === REF_MOVED) return { ...r, trainerNo: '0009175', trainerName: 'حمد الزنيدي' };
    return r;
  });
  return [
    ...changed,
    { ...ROWS[0], ref: REF_NEW, rayatCode: 'مصيم-999', courseName: 'مقرر مستحدث' },
  ];
}

describe('فروق الرفع الجديد', () => {
  const diff = diffBundle(ROWS, nextRows());

  it('الشعب الجديدة', () => {
    expect(diff.added.map((d) => d.ref)).toEqual([REF_NEW]);
    expect(diff.added[0].previousTrainerNo).toBe('');
    expect(diff.added[0].rayatCode).toBe('مصيم-999');
  });

  it('الشعب التي أُسند لها مدرب', () => {
    expect(diff.assigned.map((d) => d.ref)).toEqual([REF_ORPHAN]);
    expect(diff.assigned[0]).toMatchObject({
      previousTrainerNo: '',
      trainerNo: '0005527',
      trainerName: 'خالد الواصل',
    });
  });

  it('الشعب التي تغيّر مدربها', () => {
    expect(diff.changed.map((d) => d.ref)).toEqual([REF_MOVED]);
    expect(diff.changed[0]).toMatchObject({
      previousTrainerNo: TRAINER,
      previousTrainerName: 'محمد الشبيلي',
      trainerNo: '0009175',
    });
  });

  it('الشعب المحذوفة تحتفظ بمدربها السابق', () => {
    expect(diff.removed.map((d) => d.ref)).toEqual([REF_DROPPED]);
    expect(diff.removed[0]).toMatchObject({
      trainerNo: '',
      previousTrainerNo: TRAINER,
      rayatCode: 'مصيم-261',
    });
  });

  it('الباقي مطابق، وكل شعبة تُصنَّف مرة واحدة مهما تعددت لقاءاتها', () => {
    const all = [...diff.added, ...diff.assigned, ...diff.changed, ...diff.removed, ...diff.same];
    expect(new Set(all.map((d) => d.ref)).size).toBe(all.length);
    expect(all).toHaveLength(37); // ٣٦ شعبة في العيّنة + الجديدة، والمحذوفة منها
    expect(diff.same).toHaveLength(33);
    // الشعبة ذات اللقاءين تُصنَّف مطابقة مرة واحدة
    expect(diff.same.filter((d) => d.ref === '10776')).toHaveLength(1);
    // والشعب التي بقيت بلا مدرب مطابقة أيضاً
    expect(diff.same.some((d) => d.ref === '10570' && d.trainerNo === '')).toBe(true);
  });

  it('رفع المدرب عن شعبته تغيّرٌ يظهر للأدمن لا مطابقة صامتة', () => {
    const stripped = ROWS.map((r) =>
      r.ref === REF_MOVED ? { ...r, trainerNo: '-', trainerName: '-' } : r,
    );
    const d = diffBundle(ROWS, stripped);
    expect(d.changed.map((x) => x.ref)).toEqual([REF_MOVED]);
    expect(d.changed[0]).toMatchObject({ trainerNo: '', previousTrainerNo: TRAINER });
  });

  it('الرفع نفسه مرتين لا يظهر فيه فرق', () => {
    const d = diffBundle(ROWS, ROWS);
    expect(d.added).toHaveLength(0);
    expect(d.assigned).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.same).toHaveLength(36);
  });
});
