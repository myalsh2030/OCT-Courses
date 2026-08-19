import { z } from 'zod';
import { courseSchema } from './course.schema';
import { contactBlockSchema, trainerProfileSchema } from './department';
import { readTerm } from './term';

/**
 * النسخة الاحتياطية للمدرب — الجسر الوحيد بين جهازه والحفظ الدائم.
 *
 * تعديلات المدرب تعيش في IndexedDB على جهازه وحده، فمسح المتصفح يمحوها.
 * النسخة الاحتياطية ملفٌ واحد يحمل **كل مقرراته المسندة هذا الفصل**
 * ومسوّداته المحلية وملفه الشخصي، يرسله لرئيس القسم فيُدمج في حزمة
 * الفصل التالية. ولأنها ملف يُرسَل ويُؤرشف فاسمها يجب أن يقول ما فيه
 * بلا فتحه: `التخصص-رقم المدرب-الفصل-التاريخ`.
 *
 * الاستعادة لا تكتب فوق شيء قبل أن يرى المدرب ملخّص الملف ويؤكّد —
 * فملفٌ لفصلٍ آخر أو لمدربٍ آخر خطؤه لا يُكتشف بعد الكتابة.
 */

export const BACKUP_KIND = 'oct-trainer-backup';
export const BACKUP_FORMAT_VERSION = 1;

export const backupCourseSchema = z.object({
  courseId: z.string(),
  rayatCode: z.string(),
  name: z.string(),
  /** للمقرر تعديلٌ محلي (مسودّة) — وإلا فالمحفوظ هو الأصل كما هو. */
  hasDraft: z.boolean(),
  course: courseSchema,
});

/** شعبة مسندة كما وردت في حزمة الفصل — للأدمن حين يدمج النسخة. */
export const backupSectionSchema = z.object({
  rayatCode: z.string(),
  courseName: z.string(),
  ref: z.string(),
  type: z.string(),
});

export const backupFileSchema = z.object({
  kind: z.literal(BACKUP_KIND),
  formatVersion: z.number().int().positive(),
  term: z.string(),
  trainerNo: z.string(),
  trainerName: z.string(),
  department: z.string().default(''),
  /** بادئة رموز مقرراته العربية — هي التخصص في اسم الملف. */
  specialization: z.string().default(''),
  savedAt: z.string(),
  profile: trainerProfileSchema,
  departmentHead: contactBlockSchema.optional(),
  sections: z.array(backupSectionSchema).default([]),
  courses: z.array(backupCourseSchema),
});

export type BackupCourse = z.infer<typeof backupCourseSchema>;
export type BackupFile = z.infer<typeof backupFileSchema>;

/**
 * التخصص من بادئات رموز المقررات العربية (`مصيم-141` ⇐ `مصيم`):
 * بادئة الأغلب، فإن تساوت بادئتان فأكثر جُمعت بـ`+` مرتّبةً ترتيباً
 * ثابتاً (لا بترتيب ورودها) كي لا يتغيّر اسم الملف بين حفظٍ وآخر.
 */
export function specializationOf(rayatCodes: string[]): string {
  const counts = new Map<string, number>();
  for (const code of rayatCodes) {
    const prefix = code.split('-')[0]?.trim();
    if (!prefix || prefix === code.trim()) continue;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  if (counts.size === 0) return 'مقررات';

  const top = Math.max(...counts.values());
  return [...counts.entries()]
    .filter(([, n]) => n === top)
    .map(([prefix]) => prefix)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join('+');
}

/** تاريخ مختصر ست خانات `سسشششيي` بالتقويم الميلادي المحلي: `260819`. */
export function shortDate(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(at.getFullYear() % 100)}${two(at.getMonth() + 1)}${two(at.getDate())}`;
}

export interface BackupNameInput {
  rayatCodes: string[];
  trainerNo: string;
  term: string;
  at: Date;
}

/**
 * جذع اسم ملفات المدرب: `مصيم-0013270-144710-260819`.
 * تشترك فيه النسخة الاحتياطية وملف Excel، فيصطفّان في مجلد رئيس القسم.
 */
export function trainerFileStem({ rayatCodes, trainerNo, term, at }: BackupNameInput): string {
  return [
    specializationOf(rayatCodes),
    trainerNo || 'بلا-رقم',
    readTerm(term).code || 'بلا-فصل',
    shortDate(at),
  ].join('-');
}

/** `مصيم-0013270-144710-260819.json` */
export function backupFileName(input: BackupNameInput): string {
  return `${trainerFileStem(input)}.json`;
}

export interface BackupSummary {
  term: string;
  termLabel: string;
  trainerNo: string;
  trainerName: string;
  specialization: string;
  /** عدد المقررات في الملف. */
  courses: number;
  /** كم منها يحمل تعديلاً محلياً. */
  drafts: number;
  /** وقت الحفظ كما سُجّل في الملف (ISO). */
  savedAt: string;
}

export function summarizeBackup(file: BackupFile): BackupSummary {
  return {
    term: file.term,
    termLabel: readTerm(file.term).label,
    trainerNo: file.trainerNo,
    trainerName: file.trainerName,
    specialization: file.specialization || specializationOf(file.courses.map((c) => c.rayatCode)),
    courses: file.courses.length,
    drafts: file.courses.filter((c) => c.hasDraft).length,
    savedAt: file.savedAt,
  };
}

export type BackupReadResult =
  | { ok: true; file: BackupFile; summary: BackupSummary }
  | { ok: false; message: string };

/**
 * يقرأ ملفاً مرفوعاً ويتحقق منه قبل أي كتابة. الرسائل تقول ما الخطأ
 * بالضبط: ملفٌ من نظام آخر، أو ملفٌ تالف، أو صيغة أحدث من هذه النسخة.
 */
export function readBackup(raw: unknown): BackupReadResult {
  const envelope = z
    .object({ kind: z.literal(BACKUP_KIND), formatVersion: z.number().int().positive() })
    .safeParse(raw);
  if (!envelope.success) {
    return { ok: false, message: 'هذا ليس ملف نسخة احتياطية صادراً من هذا النظام.' };
  }
  // فحص الإصدار قبل الشكل: صيغةٌ أحدث قد لا تطابق مخطط هذه النسخة أصلاً،
  // فوصفها بـ«تالفة» تضليلٌ يدفع المدرب لإعادة الحفظ بلا داعٍ.
  if (envelope.data.formatVersion > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      message: 'الملف من نسخة أحدث من هذا الموقع — حدِّث الصفحة ثم أعد المحاولة.',
    };
  }

  const parsed = backupFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      message: `ملف النسخة الاحتياطية تالف أو ناقص: ${first?.path.join('.') ?? ''} — ${first?.message ?? ''}`,
    };
  }
  return { ok: true, file: parsed.data, summary: summarizeBackup(parsed.data) };
}
