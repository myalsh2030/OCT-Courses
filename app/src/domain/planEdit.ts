import type { PlanWeek } from './course.schema';
import { unitCode, WEEK_ORDINALS } from './vocab';

/**
 * جراحة صفوف أسبوع الخطة: تعديل موضوع، إضافة صف موضوع، حذف صف موضوع.
 *
 * صفوف المحتوى هي التي تحمل ترقيماً (code)؛ صفوف الاختبارات (فترة/نهائي
 * مضمَّن) بلا ترقيم وتبقى مقفلة لا تُعدَّل ولا تُحذف، وهي دائماً في ذيل
 * قائمة صفوف الأسبوع كما يبنيها المولّد.
 *
 * الدوال تُحوِّر الأسبوع في مكانه — المستدعي (applyEdit) يستنسخ المقرر
 * قبلها، وsaveDraft يتحقق بالمخطط بعدها فلا تُكتب بنية مكسورة أبداً.
 */

type SpanCell = { span: number };

const SPAN_COLUMNS = ['week', 'hours', 'objectives', 'strategies', 'tools', 'grades'] as const;

/** عدد صفوف المحتوى (المرقّمة) في الأسبوع. */
export function contentRowCount(week: PlanWeek): number {
  return week.units.filter((u) => u.code !== undefined).length;
}

/** هل هذا الصف صفَّ محتوى قابلاً للتحرير (لا صف اختبار)؟ */
export function isContentRow(week: PlanWeek, rowIndex: number): boolean {
  return week.units[rowIndex]?.code !== undefined;
}

/** يوسّع (أو يقلّص) الخلية التي تغطي الصف المعطى في عمود ممتد. */
function resizeCovering(cells: SpanCell[], rowIndex: number, delta: 1 | -1): void {
  let start = 0;
  for (const cell of cells) {
    if (rowIndex < start + cell.span) {
      cell.span += delta;
      return;
    }
    start += cell.span;
  }
  cells[cells.length - 1].span += delta;
}

/** يعيد ترقيم صفوف المحتوى «أسبوع ـ صف» بعد إضافة أو حذف. */
function renumber(week: PlanWeek): void {
  const ordinal = week.week[0]?.text ?? '';
  const weekNo = (WEEK_ORDINALS as readonly string[]).indexOf(ordinal) + 1;
  if (weekNo === 0) return; // أسبوع مدموج (نهائي) — لا يصل هنا أصلاً
  let row = 0;
  for (const cell of week.units) {
    if (cell.code !== undefined) {
      row += 1;
      cell.code = unitCode(weekNo, row);
    }
  }
}

/** يستبدل نص موضوع صف محتوى؛ صفوف الاختبارات تُتجاهل. */
export function setUnitTopic(week: PlanWeek, rowIndex: number, text: string): void {
  const cell = week.units[rowIndex];
  if (cell?.code === undefined) return;
  cell.text = text;
}

/** يضيف صف موضوع جديداً في نهاية صفوف المحتوى (قبل صفوف الاختبارات). */
export function addUnitRow(week: PlanWeek): void {
  const insertAt = contentRowCount(week);
  if (insertAt === 0) return; // أسبوع نهائي كامل — مقفل
  week.units.splice(insertAt, 0, { code: '', text: 'موضوع جديد', span: 1 });
  week.rowCount += 1;
  for (const column of SPAN_COLUMNS) {
    resizeCovering(week[column] as unknown as SpanCell[], insertAt - 1, 1);
  }
  renumber(week);
}

/**
 * يحذف صف موضوع. يرفض حذف صفوف الاختبارات، وآخر صف محتوى في الأسبوع،
 * والصفوف ذات الامتداد المركّب (لا تنتجها الصيغة الحالية).
 * @returns هل نُفِّذ الحذف.
 */
export function removeUnitRow(week: PlanWeek, rowIndex: number): boolean {
  const cell = week.units[rowIndex];
  if (cell?.code === undefined || cell.span !== 1) return false;
  if (contentRowCount(week) <= 1) return false;
  week.units.splice(rowIndex, 1);
  week.rowCount -= 1;
  for (const column of SPAN_COLUMNS) {
    const cells = week[column] as unknown as SpanCell[];
    resizeCovering(cells, rowIndex, -1);
    // خلية تقلّص امتدادها إلى صفر (بيانات قديمة غير مدموجة) تُزال
    const dead = cells.findIndex((c) => c.span === 0);
    if (dead >= 0 && cells.length > 1) cells.splice(dead, 1);
  }
  renumber(week);
  return true;
}
