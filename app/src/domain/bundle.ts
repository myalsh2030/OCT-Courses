import { z } from 'zod';
import type { SS01Row } from './ss01';
import {
  DEFAULT_ITERATIONS,
  deriveEntryKey,
  importRecordKey,
  normalizeRef,
  normalizeTrainerNo,
  randomId,
  randomRecordKey,
  randomSalt,
  seal,
  sealBytes,
  unseal,
  unsealBytes,
} from './vault';

/**
 * حزمة الفصل المعمّاة — ما يُنشر فعلاً بدل تقرير الشعب.
 *
 * الحزمة ملف JSON واحد لا يحمل اسماً ولا رقماً ولا رقماً مرجعياً ظاهراً:
 * مفاتيحه بصماتٌ ست عشرية، وقيمه نصوص مشفّرة. من نزّله ولا يعرف زوجاً
 * صحيحاً لم يحصل على شيء.
 *
 * **التخزين على مستويين** — والسبب حجمُ ما يُنزَّل على بيانات الجوال:
 *
 * 1. `records`: سجل كل مدرب مشفَّراً **مرة واحدة** بمفتاح سجل عشوائي، تحت
 *    معرّف عشوائي لا يدل على صاحبه.
 * 2. `entries`: لكل زوج (رقم المدرب، رقم مرجعي من شعبه) مدخلٌ صغير
 *    `{ r: معرّف السجل، k: مفتاح السجل مغلّفاً بمفتاح الزوج المشتق }`.
 *
 * فأي رقم مرجعي من شعبه يفتح سجله كاملاً ولا يُطالَب بحفظ رقم بعينه، ولا
 * يتكرر مع كل شعبة إلا مفتاحٌ مغلّف (٣٢ بايت) بدل سجلٍ كامل. المدخل الأول
 * كان يحمل السجل نفسه مكرراً فبلغت حزمة الفصل ١٫٨ م.ب — والمستويان يردّانها
 * إلى نحو خُمس ذلك بلا تغيير في زمن دخول المدرب: اشتقاق PBKDF2 واحد كما كان.
 *
 * ما يكشفه الملف بعد ذلك: عدد الشعب المسندة (عدد المداخل) وعدد المدربين
 * (عدد السجلات) — وكلاهما مقبول، إذ لا يدل على أحدٍ بعينه.
 *
 * القراءة من تقرير SS01 بقارئ المشروع الوحيد (`ss01.ts`)، والتعمية بـ
 * `vault.ts`. هذا الملف يعرف البيانات ولا يعرف التشفير.
 */

/** ٢ = التخزين على مستويين؛ ١ كان يكرر السجل تحت كل رقم مرجعي. */
export const BUNDLE_VERSION = 2;

/* ───────────────────────── المخططات ───────────────────────── */

/** لقاء واحد لشعبة — الشعبة قد تلتقي في أكثر من يوم أو قاعة. */
export const sectionMeetingSchema = z.object({
  day: z.string(),
  time: z.string(),
  building: z.string(),
  room: z.string(),
});

export const trainerSectionSchema = z.object({
  /** رمز المقرر في رايات، مثل «مصيم-141». */
  rayatCode: z.string(),
  courseName: z.string(),
  ref: z.string(),
  /** نوع الشعبة كما في التقرير: «نظري صباحي»، «عملي صباحي»… */
  type: z.string(),
  meetings: z.array(sectionMeetingSchema),
  /** الأعداد كما وردت؛ `null` حين تكون الخانة فارغة في التقرير. */
  capacity: z.number().nullable(),
  enrolled: z.number().nullable(),
  remaining: z.number().nullable(),
});

export const trainerRecordSchema = z.object({
  term: z.string(),
  /** سبع خانات مطبَّعة. */
  trainerNo: z.string(),
  trainerName: z.string(),
  department: z.string(),
  sections: z.array(trainerSectionSchema),
});

/** مدخل الزوج: معرّف السجل، ومفتاح السجل مغلّفاً بمفتاح الزوج. */
export const bundleEntrySchema = z.object({
  r: z.string(),
  k: z.string(),
});

export const vaultBundleSchema = z.object({
  version: z.number().int().positive(),
  term: z.string(),
  /** ملح PBKDF2 بترميز base64 — يُنشر مع الحزمة، وسرّيته ليست مطلوبة. */
  salt: z.string(),
  iterations: z.number().int().positive(),
  /** `معرّف عشوائي ← سجل المدرب مشفّراً مرة واحدة`. */
  records: z.record(z.string(), z.string()),
  /** `بصمة الزوج ← مدخلٌ صغير يدل على السجل ويحمل مفتاحه مغلّفاً`. */
  entries: z.record(z.string(), bundleEntrySchema),
});

export type SectionMeeting = z.infer<typeof sectionMeetingSchema>;
export type TrainerSection = z.infer<typeof trainerSectionSchema>;
export type TrainerRecord = z.infer<typeof trainerRecordSchema>;
export type BundleEntry = z.infer<typeof bundleEntrySchema>;
export type VaultBundle = z.infer<typeof vaultBundleSchema>;

/* ───────────────────────── التجميع ───────────────────────── */

/** عددٌ من خانة نصية في التقرير؛ الفارغ وغير الرقمي `null` لا صفر. */
function toCount(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * يجمع صفوف التقرير في سجل لكل مدرب: شعبه بلا تكرار، ولقاءات كل شعبة
 * مجموعة تحتها. الشعب بلا مدرب («-» في التقرير) تُترك — لا سجل لها.
 */
export function collectTrainers(rows: SS01Row[]): TrainerRecord[] {
  const byTrainer = new Map<string, TrainerRecord>();
  const sections = new Map<string, TrainerSection>();

  for (const row of rows) {
    const trainerNo = normalizeTrainerNo(row.trainerNo);
    const ref = normalizeRef(row.ref);
    if (!trainerNo || !ref) continue;

    let record = byTrainer.get(trainerNo);
    if (!record) {
      record = {
        term: row.term,
        trainerNo,
        trainerName: row.trainerName,
        department: row.department,
        sections: [],
      };
      byTrainer.set(trainerNo, record);
    }
    // الحقول الناقصة في أول صف تُستكمل من صف لاحق للمدرب نفسه
    record.term ||= row.term;
    record.trainerName ||= row.trainerName;
    record.department ||= row.department;

    const key = `${trainerNo}|${ref}`;
    let section = sections.get(key);
    if (!section) {
      section = {
        rayatCode: row.rayatCode,
        courseName: row.courseName,
        ref,
        type: row.type,
        meetings: [],
        capacity: toCount(row.capacity),
        enrolled: toCount(row.enrolled),
        remaining: toCount(row.remaining),
      };
      sections.set(key, section);
      record.sections.push(section);
    }

    const meeting: SectionMeeting = {
      day: row.day,
      time: row.time,
      building: row.building,
      room: row.room,
    };
    const empty = !meeting.day && !meeting.time && !meeting.room;
    const seen = section.meetings.some(
      (m) =>
        m.day === meeting.day &&
        m.time === meeting.time &&
        m.building === meeting.building &&
        m.room === meeting.room,
    );
    if (!empty && !seen) section.meetings.push(meeting);
  }

  const records = [...byTrainer.values()];
  for (const record of records) {
    record.sections.sort(
      (a, b) => a.rayatCode.localeCompare(b.rayatCode, 'ar') || a.ref.localeCompare(b.ref, undefined, { numeric: true }),
    );
  }
  return records.sort((a, b) => a.trainerNo.localeCompare(b.trainerNo));
}

/* ───────────────────────── البناء ───────────────────────── */

export interface BuildBundleOptions {
  /** الفصل التدريبي؛ يُؤخذ من الصفوف إن لم يُمرَّر. */
  term?: string;
  /** دورات PBKDF2؛ تُخفَّض في الاختبارات وحدها. */
  iterations?: number;
  /** ملح ثابت — للاختبارات؛ الافتراضي ملح عشوائي جديد لكل حزمة. */
  salt?: string;
}

/**
 * يبني حزمة الفصل المعمّاة من صفوف تقرير SS01.
 *
 * لكل مدرب: معرّف سجل عشوائي، ومفتاح سجل عشوائي يُشفَّر به سجله مرة واحدة،
 * ثم يُغلَّف هذا المفتاح تحت كل زوج (رقمه، رقم مرجعي من شعبه).
 *
 * المداخل والسجلات تُرتَّب بمعرّفاتها العشوائية لا بترتيب المدربين — فالترتيب
 * نفسه لا يدل على شيء: لا يُعرف من الملف أن ثلاثة مداخل متجاورة لمدرب واحد.
 */
export async function buildBundle(
  rows: SS01Row[],
  options: BuildBundleOptions = {},
): Promise<VaultBundle> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const salt = options.salt ?? randomSalt();
  const term = options.term || rows.find((r) => r.term)?.term || '';
  const params = { salt, iterations };

  const records: [string, string][] = [];
  const pairs: [string, BundleEntry][] = [];

  for (const record of collectTrainers(rows)) {
    const recordId = randomId();
    const recordKey = await randomRecordKey();
    records.push([recordId, await seal(recordKey.key, JSON.stringify({ ...record, term }))]);

    // شعب المدرب الواحد تُشتق معاً: المتصفح ينفّذ PBKDF2 خارج الخيط الرئيسي
    // فيستفيد من التوازي، والبناء عملية أدمن على مئات الشعب.
    const sealed = await Promise.all(
      record.sections.map(async (section) => {
        const { entryId, key } = await deriveEntryKey(record.trainerNo, section.ref, params);
        return [entryId, { r: recordId, k: await sealBytes(key, recordKey.raw) }] as [
          string,
          BundleEntry,
        ];
      }),
    );
    pairs.push(...sealed);
  }

  const byId = (a: [string, unknown], b: [string, unknown]) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  records.sort(byId);
  pairs.sort(byId);

  return {
    version: BUNDLE_VERSION,
    term,
    salt,
    iterations,
    records: Object.fromEntries(records),
    entries: Object.fromEntries(pairs),
  };
}

/**
 * يفتح سجل مدرب من الحزمة بزوج (رقمه، رقم مرجعي من شعبه)، أو `null`.
 *
 * خطوتان: اشتقاق مفتاح الزوج (PBKDF2 مرة واحدة — وهو كل زمن الانتظار)، ثم
 * فكّ غلاف مفتاح السجل به، ثم فكّ السجل بمفتاحه. المرحلتان الأخيرتان
 * لحظيتان، فزمن دخول المدرب هو زمن الاشتقاق وحده.
 *
 * الفشل واحد لا يتجزأ: رقم مدرب خاطئ، ورقم مرجعي لمدرب آخر، وحزمة تالفة —
 * كلها `null` بلا فرق. التمييز بينها تسريبٌ يقرّب المهاجم من الجواب،
 * وصياغة الرسالة شأن الواجهة لا شأن هذه الطبقة.
 */
export async function openBundle(
  bundle: unknown,
  trainerNo: string,
  refNo: string,
): Promise<TrainerRecord | null> {
  try {
    const parsed = vaultBundleSchema.safeParse(bundle);
    if (!parsed.success) return null;

    const no = normalizeTrainerNo(trainerNo);
    const ref = normalizeRef(refNo);
    if (!no || !ref) return null;

    const { salt, iterations, entries, records } = parsed.data;
    const { entryId, key } = await deriveEntryKey(no, ref, { salt, iterations });
    if (!Object.hasOwn(entries, entryId)) return null;

    const entry = entries[entryId];
    const recordKeyBytes = await unsealBytes(key, entry.k);
    if (!recordKeyBytes || recordKeyBytes.length !== 32) return null;
    if (!Object.hasOwn(records, entry.r)) return null;

    const plain = await unseal(await importRecordKey(recordKeyBytes), records[entry.r]);
    if (!plain) return null;

    const record = trainerRecordSchema.safeParse(JSON.parse(plain));
    return record.success ? record.data : null;
  } catch {
    return null;
  }
}

/* ───────────────────────── الفروق ───────────────────────── */

/**
 * حال الشعبة في الرفع الجديد قياساً على المحفوظ:
 * `added` جديدة، و`assigned` كانت بلا مدرب فأُسند لها، و`changed` تغيّر
 * مدربها (ويدخل فيها من رُفع عنها مدربها)، و`removed` اختفت، و`same` مطابقة.
 */
export type SectionChange = 'added' | 'assigned' | 'changed' | 'removed' | 'same';

export interface SectionDiff {
  ref: string;
  rayatCode: string;
  courseName: string;
  type: string;
  /** مدرب الشعبة بعد الرفع؛ فارغ للمحذوفة وللتي بلا مدرب. */
  trainerNo: string;
  trainerName: string;
  /** مدربها قبل الرفع؛ فارغ للجديدة وللتي كانت بلا مدرب. */
  previousTrainerNo: string;
  previousTrainerName: string;
  change: SectionChange;
}

export interface BundleDiff {
  added: SectionDiff[];
  assigned: SectionDiff[];
  changed: SectionDiff[];
  removed: SectionDiff[];
  same: SectionDiff[];
}

interface IndexedSection {
  ref: string;
  rayatCode: string;
  courseName: string;
  type: string;
  trainerNo: string;
  trainerName: string;
}

/** شعبة واحدة لكل رقم مرجعي؛ صفوف اللقاءات المتكررة تُدمج. */
function indexSections(rows: SS01Row[]): Map<string, IndexedSection> {
  const index = new Map<string, IndexedSection>();
  for (const row of rows) {
    const ref = normalizeRef(row.ref);
    if (!ref) continue;
    const trainerNo = normalizeTrainerNo(row.trainerNo);
    const existing = index.get(ref);
    if (!existing) {
      index.set(ref, {
        ref,
        rayatCode: row.rayatCode,
        courseName: row.courseName,
        type: row.type,
        trainerNo,
        trainerName: trainerNo ? row.trainerName : '',
      });
      continue;
    }
    if (!existing.trainerNo && trainerNo) {
      existing.trainerNo = trainerNo;
      existing.trainerName = row.trainerName;
    }
  }
  return index;
}

const byRef = (a: SectionDiff, b: SectionDiff) =>
  a.ref.localeCompare(b.ref, undefined, { numeric: true });

/**
 * فروق رفعٍ جديد عن المحفوظ — ما تعرضه صفحة الأدمن قبل أن يستبدل الحزمة.
 * وحدة المقارنة الشعبة (الرقم المرجعي)، لا المدرب ولا المقرر.
 */
export function diffBundle(previousRows: SS01Row[], nextRows: SS01Row[]): BundleDiff {
  const previous = indexSections(previousRows);
  const next = indexSections(nextRows);
  const diff: BundleDiff = { added: [], assigned: [], changed: [], removed: [], same: [] };

  for (const [ref, section] of next) {
    const before = previous.get(ref);
    const entry: SectionDiff = {
      ref,
      rayatCode: section.rayatCode,
      courseName: section.courseName,
      type: section.type,
      trainerNo: section.trainerNo,
      trainerName: section.trainerName,
      previousTrainerNo: before?.trainerNo ?? '',
      previousTrainerName: before?.trainerName ?? '',
      change: 'same',
    };

    if (!before) entry.change = 'added';
    else if (!before.trainerNo && section.trainerNo) entry.change = 'assigned';
    else if (before.trainerNo !== section.trainerNo) entry.change = 'changed';
    diff[entry.change].push(entry);
  }

  for (const [ref, section] of previous) {
    if (next.has(ref)) continue;
    diff.removed.push({
      ref,
      rayatCode: section.rayatCode,
      courseName: section.courseName,
      type: section.type,
      trainerNo: '',
      trainerName: '',
      previousTrainerNo: section.trainerNo,
      previousTrainerName: section.trainerName,
      change: 'removed',
    });
  }

  for (const bucket of Object.values(diff)) bucket.sort(byRef);
  return diff;
}
