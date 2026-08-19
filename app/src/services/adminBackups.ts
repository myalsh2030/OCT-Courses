import { readBackup, type BackupFile, type BackupSummary } from '../domain/backup';
import { readTerm } from '../domain/term';
import { normalizeTrainerNo } from '../domain/vault';

/**
 * استقبال نسخ المدربين الاحتياطية في صفحة الأدمن.
 *
 * المدرب يحفظ نسخته على جهازه ويرسلها لرئيس القسم، فيرفعها الأدمن هنا.
 * وظيفة هذه الوحدة أن تقول عن كل ملف: **هل يصحّ دمجه؟** ولا تدمج شيئاً.
 *
 * التضاربات الثلاثة تُعرض ولا تُبتلع:
 * 1. **نسخة أقدم**: رُفعت للمدرب نفسه نسخةٌ أحدث، فدمج الأقدم يمحو عملاً.
 * 2. **فصلٌ آخر**: النسخة لفصلٍ غير المعروض، فمقرراتها وشعبها ليست هذه.
 * 3. **مدربٌ بلا شعب**: صاحب النسخة لا شعبة له في تقرير هذا الفصل، فإما
 *    أن الملف قديم أو أن التقرير لم يُحدَّث بعد — وكلاهما يُراجَع لا يُدمج.
 *
 * ما يُقرأ هنا يبقى في الجلسة: بيانات منسوبين صريحة لا تُحفظ ولا تُنشر.
 */

export type BackupStatus = 'ready' | 'older' | 'other-term' | 'unknown-trainer' | 'invalid';

/** ملفٌ رُفع وقُرئ — قبل الحكم عليه. */
export interface ParsedBackup {
  fileName: string;
  file: BackupFile | null;
  summary: BackupSummary | null;
  /** رسالة رفض القراءة إن لم يكن ملف نسخة صالحاً. */
  error: string;
}

/** سطر في جدول النسخ المستلمة. */
export interface ReceivedBackup {
  id: string;
  fileName: string;
  trainerNo: string;
  trainerName: string;
  specialization: string;
  term: string;
  termLabel: string;
  savedAt: string;
  courses: number;
  drafts: number;
  status: BackupStatus;
  /** سبب الحالة بالعربية — لا شارة بلا تفسير. */
  message: string;
  file: BackupFile | null;
}

export interface ReceiveContext {
  /** الفصل المعروض في الصفحة. */
  term: string;
  /** أرقام المدربين المسندين في تقرير هذا الفصل (مطبَّعة). */
  trainerNumbers: string[];
}

export const BACKUP_STATUS_LABEL: Record<BackupStatus, string> = {
  ready: 'جاهز للدمج',
  older: 'نسخة أقدم',
  'other-term': 'فصلٌ آخر',
  'unknown-trainer': 'مدرب بلا شعب',
  invalid: 'ملف غير صالح',
};

/** لاحقة صنف الشارة لكل حالة. */
export const BACKUP_STATUS_CLASS: Record<BackupStatus, string> = {
  ready: 'info',
  older: 'warning',
  'other-term': 'warning',
  'unknown-trainer': 'warning',
  invalid: 'danger',
};

/** يقرأ نص ملف مرفوع ويتحقق من شكله بقارئ النسخ نفسه. */
export function parseBackupText(fileName: string, text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { fileName, file: null, summary: null, error: 'الملف ليس JSON صالحاً.' };
  }
  const read = readBackup(raw);
  if (!read.ok) return { fileName, file: null, summary: null, error: read.message };
  return { fileName, file: read.file, summary: read.summary, error: '' };
}

/** وقت الحفظ قابلاً للمقارنة؛ التاريخ التالف يُعامَل أقدمَ ما يكون. */
function savedTime(at: string): number {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * يحكم على النسخ المرفوعة **مجتمعةً**: حالة النسخة قد تتغيّر برفع نسخةٍ
 * أخرى للمدرب نفسه، فلا يصحّ تثبيت حكمٍ عند الرفع ثم نسيانه. الأحدث لكل
 * مدرب هو المرشَّح للدمج، وما دونه «نسخة أقدم».
 */
export function classifyBackups(
  parsed: ParsedBackup[],
  context: ReceiveContext,
): ReceivedBackup[] {
  const term = readTerm(context.term).code;
  const known = new Set(context.trainerNumbers.map(normalizeTrainerNo));

  /** أحدث وقت حفظ لكل مدرب بين النسخ المقروءة. */
  const newest = new Map<string, number>();
  for (const item of parsed) {
    if (!item.file) continue;
    const no = normalizeTrainerNo(item.file.trainerNo);
    const at = savedTime(item.file.savedAt);
    if (at > (newest.get(no) ?? -1)) newest.set(no, at);
  }

  const seenNewest = new Set<string>();

  return parsed.map((item, index) => {
    const id = `${item.fileName}#${index}`;
    if (!item.file || !item.summary) {
      return {
        id,
        fileName: item.fileName,
        trainerNo: '',
        trainerName: '',
        specialization: '',
        term: '',
        termLabel: '',
        savedAt: '',
        courses: 0,
        drafts: 0,
        status: 'invalid',
        message: item.error,
        file: null,
      };
    }

    const file = item.file;
    const summary = item.summary;
    const trainerNo = normalizeTrainerNo(file.trainerNo);
    const fileTerm = readTerm(file.term).code;
    const at = savedTime(file.savedAt);

    let status: BackupStatus = 'ready';
    let message = 'الملف صالح، ومدربه من مدربي هذا الفصل — للاعتماد والدمج.';

    if (term && fileTerm !== term) {
      status = 'other-term';
      message = `النسخة لـ${readTerm(fileTerm).label} والمعروض ${readTerm(term).label} — لا تُدمج قبل مراجعتها.`;
    } else if (known.size > 0 && !known.has(trainerNo)) {
      status = 'unknown-trainer';
      message = 'لا شعبة لهذا المدرب في تقرير الفصل المعروض — راجع التقرير أو تاريخ النسخة.';
    } else if (at < (newest.get(trainerNo) ?? at) || seenNewest.has(trainerNo)) {
      // الأقدم، وكذلك المتساوية مع نسخةٍ سبقتها في الرفع: واحدة تُدمج لا اثنتان
      status = 'older';
      message = 'رُفعت لهذا المدرب نسخةٌ أحدث في هذه الجلسة — دمج الأقدم يمحو عمله.';
    } else {
      seenNewest.add(trainerNo);
    }

    return {
      id,
      fileName: item.fileName,
      trainerNo: file.trainerNo,
      trainerName: file.trainerName,
      specialization: summary.specialization,
      term: fileTerm,
      termLabel: readTerm(fileTerm).label,
      savedAt: file.savedAt,
      courses: summary.courses,
      drafts: summary.drafts,
      status,
      message,
      file,
    };
  });
}
