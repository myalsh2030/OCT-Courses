import type { Course, PlanWeek } from './course.schema';
import { buildSemester, type CourseHours, type SemesterLength } from './semester';
import { weekOrdinal } from './vocab';

/**
 * تكييف طول الفصل وقت العرض.
 *
 * الملف المخزَّن قانوني دائماً بطول ١٩ أسبوعاً (أطول صورة)، لأن أسابيع
 * التدريس الستة عشر متطابقة عبر الأطوال — الفرق كله في أسابيع الاختبار
 * النهائي. فالتحويل إلى ١٧ أو ١٨ استبدالُ ذيلٍ لا إعادة توليد، وبذلك
 * لا تُمسّ تعديلات المدرب على أسابيع التدريس أبداً.
 */

const FINAL_PRACTICAL_GRADE = 13;
const FINAL_THEORY_GRADE = 27;
const FINAL_TOTAL = 40;

const FINAL_PREFIX = 'اختبار نهائي';

/** يبني أسابيع الاختبار النهائي لطولٍ ونمطِ مقررٍ معيّنين. */
export function finalPlanWeeks(hours: CourseHours, length: SemesterLength): PlanWeek[] {
  const finals = buildSemester(hours, length).weeks.filter((w) =>
    w.kind.startsWith('final'),
  );
  const mixed = hours.l > 0 && hours.p > 0;

  return finals.map((w) => {
    const rowCount = w.numbers.length;
    const label =
      w.kind === 'finalCombined'
        ? 'اختبار نهائي ( عملي ونظري )'
        : w.kind === 'finalPractical'
          ? 'اختبار نهائي عملي'
          : 'اختبار نهائي نظري';
    const objective =
      w.kind === 'finalTheory'
        ? 'يطبق المهارات النظرية السابقة بشكل صحيح'
        : w.kind === 'finalPractical'
          ? 'يطبق المهارات العملية السابقة بشكل صحيح'
          : 'يطبق المهارات السابقة بشكل صحيح';
    const grade = !mixed
      ? FINAL_TOTAL
      : w.kind === 'finalCombined'
        ? FINAL_TOTAL
        : w.kind === 'finalPractical'
          ? FINAL_PRACTICAL_GRADE
          : FINAL_THEORY_GRADE;

    return {
      rowCount,
      week: w.numbers.map((n) => ({ text: weekOrdinal(n), span: 1 })),
      units: [{ text: label, span: rowCount }],
      hours: [{ value: null, span: rowCount }],
      objectives: [{ lines: [objective], span: rowCount }],
      strategies: [{ text: '', span: rowCount }],
      tools: [{ text: 'اختبار نهائي', span: rowCount }],
      grades: [{ value: grade, span: rowCount }],
    };
  });
}

/** هل هذا الأسبوع من أسابيع الاختبار النهائي؟ */
export function isFinalWeek(week: PlanWeek): boolean {
  return week.units[0]?.text.startsWith(FINAL_PREFIX) ?? false;
}

const EMBEDDED_LABEL = 'اختبار نهائي عملي';
const EMBEDDED_OBJECTIVE = 'يطبق المهارات العملية السابقة بشكل صحيح.';

/** هل يحمل هذا الأسبوع التدريسي صفَّ اختبارٍ نهائي عملي مضمَّناً؟ */
export function hasEmbeddedFinal(week: PlanWeek): boolean {
  return (
    week.units.length > 1 &&
    week.units[week.units.length - 1].text === EMBEDDED_LABEL
  );
}

/** يمدّ امتداد آخر خلية في العمود صفاً واحداً. */
function extendLast<C extends { span: number }>(cells: C[], by: 1 | -1): C[] {
  const out = cells.map((c) => ({ ...c }));
  out[out.length - 1].span += by;
  return out;
}

/**
 * يضمّن صف «اختبار نهائي عملي» في أسبوع تدريسي (الأسبوع ١٦ في الطولين
 * ١٧ و١٨) على نسق أسبوعي اختبار الفترة: المحتوى وساعاته كما هي، وصفٌّ
 * إضافي يحمل الاختبار وأداته ودرجته (١٣).
 */
export function embedPracticalFinal(week: PlanWeek): PlanWeek {
  if (hasEmbeddedFinal(week)) return week;
  const objectives = extendLast(week.objectives, 1);
  const last = objectives[objectives.length - 1];
  last.lines = [...last.lines, `${last.lines.length + 1}. ${EMBEDDED_OBJECTIVE}`];

  return {
    ...week,
    rowCount: week.rowCount + 1,
    week: extendLast(week.week, 1),
    units: [...week.units, { text: EMBEDDED_LABEL, span: 1 }],
    hours: extendLast(week.hours, 1),
    objectives,
    strategies: extendLast(week.strategies, 1),
    tools: [...week.tools, { text: 'اختبار نهائي', span: 1 }],
    grades: [...week.grades, { value: FINAL_PRACTICAL_GRADE, span: 1 }],
  };
}

/** يعيد الأسبوع إلى صورته القانونية بنزع صف الاختبار المضمَّن. */
export function stripEmbeddedFinal(week: PlanWeek): PlanWeek {
  if (!hasEmbeddedFinal(week)) return week;
  const objectives = extendLast(week.objectives, -1);
  const last = objectives[objectives.length - 1];
  if (last.lines[last.lines.length - 1]?.endsWith(EMBEDDED_OBJECTIVE)) {
    last.lines = last.lines.slice(0, -1);
  }

  return {
    ...week,
    rowCount: week.rowCount - 1,
    week: extendLast(week.week, -1),
    units: week.units.slice(0, -1),
    hours: extendLast(week.hours, -1),
    objectives,
    strategies: extendLast(week.strategies, -1),
    tools: week.tools.slice(0, -1),
    grades: week.grades.slice(0, -1),
  };
}

export function courseHoursOf(course: Course): CourseHours {
  return {
    cth: course.contactHours,
    l: course.lectureHours,
    p: course.labHours,
    t: 0,
  };
}

/**
 * يعيد نسخة من المقرر بطول الفصل المطلوب: أسابيع التدريس كما هي
 * (بتعديلات المدرب إن وُجدت)، وأسابيع النهائي مُستبدلة. في الطولين
 * ١٧ و١٨ للمقرر المختلط يُضمَّن الاختبار العملي في الأسبوع ١٦
 * (قاعدة المالك: الذيل نظري دائماً والعملي قبله).
 */
export function adaptCourseLength(course: Course, length: SemesterLength): Course {
  const hours = courseHoursOf(course);
  const teaching = course.plan
    .filter((w) => !isFinalWeek(w))
    .map(stripEmbeddedFinal);
  const skeleton = buildSemester(hours, length);
  if (skeleton.weeks.some((w) => w.carriesPracticalFinal)) {
    teaching[teaching.length - 1] = embedPracticalFinal(teaching[teaching.length - 1]);
  }
  const finals = finalPlanWeeks(hours, length);
  return { ...course, plan: [...teaching, ...finals] };
}
