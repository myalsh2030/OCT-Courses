import type { SS01Row } from '../domain/ss01';
import { readTerm } from '../domain/term';
import { normalizeRef, normalizeTrainerNo } from '../domain/vault';
import { getStorage } from '../storage';

/**
 * أرشيف تقارير الشعب على جهاز الأدمن — لقطة واحدة لكل فصل تدريبي.
 *
 * الأدمن يرفع تقرير رايات في متصفحه، فتُحفظ صفوفه كما قُرئت تحت رمز
 * فصله في IndexedDB (لا في `localStorage`: التقرير مئات الصفوف، والمخزن
 * القائم يعرف كيف يحفظها دفعةً واحدة). ولذلك سببان:
 *
 * 1. **الفروق**: الرفعة التالية تُقارَن باللقطة المحفوظة، فيرى الأدمن ما
 *    تغيّر فعلاً قبل أن يستبدل حزمة الفصل.
 * 2. **العودة إلى فصل سابق**: اللقطة تكفي لإعادة بناء حزمته من جديد بلا
 *    البحث عن ملف CSV قديم في القرص.
 *
 * ما يُحفظ هنا نصٌّ صريح فيه أسماء المنسوبين، فهو **لا يُنشر ولا يُصدَّر**:
 * يبقى على جهاز الأدمن وحده، والمنشور هو الحزمة المعمّاة لا هذه اللقطة.
 */

const COLLECTION = 'ss01Terms';

export interface TermSnapshot {
  /** المعرّف هو رمز الفصل نفسه: لقطة واحدة لكل فصل تُستبدل بالأحدث. */
  id: string;
  term: string;
  /** وقت الحفظ (ISO). */
  savedAt: string;
  /** اسم الملف الذي رُفع — ليعرف الأدمن أي تقرير هذا. */
  fileName: string;
  rows: SS01Row[];
}

/** ملخّص تقرير: ما تعرضه بطاقات الملخّص وجدول الأرشيف. */
export interface TermSummary {
  term: string;
  termLabel: string;
  /** عدد الشعب (أرقام مرجعية بلا تكرار) — لا عدد صفوف الملف. */
  sections: number;
  /** عدد الشعب التي لا مدرب لها بعد. */
  unassigned: number;
  /** عدد المدربين المسندين (أرقام وظيفية بلا تكرار). */
  trainers: number;
  /** الأقسام الأكاديمية بأسمائها العربية كما وردت في التقرير. */
  departments: string[];
}

/** سطر في جدول أرشيف الفصول. */
export interface ArchivedTerm extends TermSummary {
  savedAt: string;
  fileName: string;
}

/**
 * ملخّص صفوف تقرير — وحدةُ العدّ الشعبة لا الصف: الشعبة الواحدة تتكرر
 * بصفوف حين تلتقي في أكثر من يوم أو قاعة، فعدّ الصفوف يضاعفها.
 */
export function summarizeRows(rows: SS01Row[]): TermSummary {
  const term = readTerm(rows.find((r) => r.term)?.term ?? '');
  const sections = new Map<string, boolean>();
  const trainers = new Set<string>();
  const departments = new Set<string>();

  for (const row of rows) {
    const ref = normalizeRef(row.ref);
    const trainerNo = normalizeTrainerNo(row.trainerNo);
    if (row.department.trim()) departments.add(row.department.trim());
    if (!ref) continue;
    // الشعبة مسندة إن حمل أيُّ صفٍّ من صفوفها رقم مدرب
    sections.set(ref, (sections.get(ref) ?? false) || Boolean(trainerNo));
    if (trainerNo) trainers.add(trainerNo);
  }

  let unassigned = 0;
  for (const assigned of sections.values()) if (!assigned) unassigned += 1;

  return {
    term: term.code,
    termLabel: term.label,
    sections: sections.size,
    unassigned,
    trainers: trainers.size,
    departments: [...departments].sort((a, b) => a.localeCompare(b, 'ar')),
  };
}

/** أرقام المدربين المسندين في التقرير، مطبَّعةً سبع خانات. */
export function trainerNumbersOf(rows: SS01Row[]): string[] {
  const numbers = new Set<string>();
  for (const row of rows) {
    const no = normalizeTrainerNo(row.trainerNo);
    if (no) numbers.add(no);
  }
  return [...numbers].sort();
}

/** يقرأ لقطة فصل بعينه، أو `null` إن لم يُرفع له تقرير على هذا الجهاز. */
export async function readTermSnapshot(term: string): Promise<TermSnapshot | null> {
  const code = readTerm(term).code;
  if (!code) return null;
  const storage = await getStorage();
  return (await storage.get<TermSnapshot>(COLLECTION, code)) ?? null;
}

/**
 * يحفظ لقطة الفصل المرفوع (يستبدل لقطته السابقة).
 * الفصل يُقرأ من التقرير نفسه لا من اسم الملف — اسم الملف قد يكذب.
 */
export async function saveTermSnapshot(
  rows: SS01Row[],
  fileName: string,
  at: Date = new Date(),
): Promise<TermSnapshot> {
  const code = readTerm(rows.find((r) => r.term)?.term ?? '').code;
  if (!code) throw new Error('لم يُعثر على رقم الفصل التدريبي في التقرير.');

  const snapshot: TermSnapshot = {
    id: code,
    term: code,
    savedAt: at.toISOString(),
    fileName,
    rows,
  };
  const storage = await getStorage();
  await storage.put(COLLECTION, snapshot);
  return snapshot;
}

/** أرشيف الفصول المحفوظة على هذا الجهاز، الأحدث فصلاً أولاً. */
export async function listArchivedTerms(): Promise<ArchivedTerm[]> {
  const storage = await getStorage();
  const all = await storage.getAll<TermSnapshot>(COLLECTION);
  return all
    .map((snapshot) => ({
      ...summarizeRows(snapshot.rows),
      // الفصل من اللقطة لا من صفوفها: لقطةٌ بلا صفوف تبقى معروفة الفصل
      term: snapshot.term,
      termLabel: readTerm(snapshot.term).label,
      savedAt: snapshot.savedAt,
      fileName: snapshot.fileName,
    }))
    .sort((a, b) => b.term.localeCompare(a.term, undefined, { numeric: true }));
}
