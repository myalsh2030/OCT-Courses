import type { PlanWeek } from '../domain/course.schema';
import { FORM_TEMPLATE as T } from '../domain/template';
import { BASE_ROW, C, LINE, SheetWriter, lineCount } from './sheetWriter';

/**
 * جدول الخطة التدريبية داخل ورقة Excel.
 *
 * كل عمود في الخطة قائمة خلايا ذات امتداد رأسي، فتُرسم هنا كتلاً
 * مدموجة على شبكة الأحد عشر عموداً — بنية `render/PlanTable.tsx` نفسها.
 */

/** حقول جدول الخطة على الشبكة: [أول عمود، آخر عمود]. */
const COL = {
  week: [1, 1],
  code: [2, 2],
  topic: [3, 5],
  hours: [6, 6],
  objectives: [7, 8],
  strategy: [9, 9],
  tool: [10, 10],
  grade: [11, 11],
} as const;

/**
 * جدول الخطة.
 *
 * أعمدته أعمدةُ الوثيقة نفسها، إلا أن «الوحدات» تنقسم هنا عمودين —
 * رمز الوحدة («1 ـ 2») وموضوع المحاضرة — لأن الرمز في الوثيقة يسبق
 * الموضوع داخل الخلية، وفي جدول Excel يُقرأ ويُفرز أوضح في عمود مستقل.
 */
export function planTable(w: SheetWriter, weeks: PlanWeek[]): void {
  const c = T.planColumns;
  const headers: [readonly [number, number], string][] = [
    [COL.week, c.week],
    [COL.code, 'الرمز'],
    [COL.topic, `${c.units} — ${c.unitsSub}`],
    [COL.hours, c.hours],
    [COL.objectives, `${c.objectives} — ${c.objectivesSub}`],
    [COL.strategy, c.strategy],
    [COL.tool, c.tool],
    [COL.grade, c.grade],
  ];
  const head = w.open(34);
  for (const [[from, to], title] of headers) {
    w.put(head, from, to, title, { fill: C.cell, align: 'center', wrap: true, size: 9 });
  }
  for (const week of weeks) weekRows(w, week);
}

/** يمرّ على خلايا عمود ممتد ويعطي لكل خلية صفَّ بدايتها. */
function walk<Cell extends { span: number }>(
  cells: Cell[],
  visit: (cell: Cell, start: number) => void,
): void {
  let start = 0;
  for (const cell of cells) {
    visit(cell, start);
    start += cell.span;
  }
}

/** حروف السطر الواحد في عمودَي الموضوع والأهداف — لتقدير الارتفاع. */
const TOPIC_CHARS = 38;
const OBJECTIVE_CHARS = 33;

function weekRows(w: SheetWriter, week: PlanWeek): void {
  // Excel لا يضبط ارتفاع الصف تلقائياً في الخلايا المدموجة: نقدّر ارتفاع
  // كل صف من أطول محتوى يمرّ به، موزّعاً على امتداد خليته.
  const heights = new Array<number>(week.rowCount).fill(BASE_ROW);
  const need = (start: number, span: number, lines: number) => {
    const perRow = Math.max(BASE_ROW, Math.ceil((lines * LINE) / span));
    for (let i = start; i < start + span; i += 1) heights[i] = Math.max(heights[i], perRow);
  };
  walk(week.units, (cell, start) => need(start, cell.span, lineCount(cell.text, TOPIC_CHARS)));
  walk(week.objectives, (cell, start) =>
    need(start, cell.span, lineCount(cell.lines.join('\n'), OBJECTIVE_CHARS)),
  );

  const top = w.lastRow + 1;
  for (const height of heights) w.open(height);

  const span = (start: number, cell: { span: number }) => [top + start, top + start + cell.span - 1];
  const centered = { align: 'center' as const, size: 10, wrap: true };

  walk(week.week, (cell, start) => {
    const [a, b] = span(start, cell);
    w.block(a, b, COL.week[0], COL.week[1], cell.text, { ...centered, fill: C.soft });
  });
  walk(week.units, (cell, start) => {
    const [a, b] = span(start, cell);
    w.block(a, b, COL.code[0], COL.code[1], cell.code ?? '', { ...centered, size: 9, ltr: true });
    w.block(a, b, COL.topic[0], COL.topic[1], cell.text, {
      size: 10,
      wrap: true,
      align: cell.code ? 'right' : 'center',
    });
  });
  walk(week.hours, (cell, start) => {
    const [a, b] = span(start, cell);
    w.block(a, b, COL.hours[0], COL.hours[1], cell.value ?? '', { ...centered, ltr: true });
  });
  walk(week.objectives, (cell, start) => {
    const [a, b] = span(start, cell);
    w.block(a, b, COL.objectives[0], COL.objectives[1], cell.lines.join('\n'), {
      size: 9,
      wrap: true,
    });
  });
  walk(week.strategies, (cell, start) => {
    const [a, b] = span(start, cell);
    w.block(a, b, COL.strategy[0], COL.strategy[1], cell.text, { ...centered, size: 9 });
  });
  walk(week.tools, (cell, start) => {
    const [a, b] = span(start, cell);
    w.block(a, b, COL.tool[0], COL.tool[1], cell.text, { ...centered, size: 9 });
  });
  walk(week.grades, (cell, start) => {
    const [a, b] = span(start, cell);
    w.block(a, b, COL.grade[0], COL.grade[1], cell.value ?? '', { ...centered, ltr: true });
  });
}
