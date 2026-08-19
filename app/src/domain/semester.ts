/**
 * هيكل الفصل التدريبي وتوزيع الوحدات على أسابيعه.
 *
 * القاعدة مستمدة من الخطة الرسمية (ص ٦): «ساعات الإتصال الكلية × ١٦».
 * فأسابيع التدريس الحاملة للساعات ستة عشر دائماً مهما كان طول الفصل.
 *
 * قاعدة المالك للنهائي (٢٠٢٦-٠٧-٢٩): ذيل الفصل نظريٌّ دائماً، والاختبار
 * العملي قبله — فإن لم يتسع الذيل دخل العمليُّ أسبوعَ التدريس الأخير
 * (١٦) إلى جانب محتواه، كما تفعل أسابيع اختبار الفترة:
 *
 *   ١٧ أسبوعاً → ١–١٦ ساعات (العملي داخل ١٦) + ١٧ نهائي نظري
 *   ١٨ أسبوعاً → ١–١٦ ساعات (العملي داخل ١٦) + ١٧–١٨ نهائي نظري مدموج
 *   ١٩ أسبوعاً → ١–١٦ ساعات + ١٧ نهائي عملي + ١٨–١٩ نهائي نظري مدموج
 *
 * المقرر أحاديّ النمط له نهائي واحد من نمطه يبتلع الذيل كله.
 * الثابت الذي لا يُخرق: Σ ساعات الأسابيع = س.أ × ١٦.
 */

export const TEACHING_WEEKS = 16;
export const PERIOD_EXAM_WEEKS = [7, 13] as const;
export const REVIEW_WEEK = 16;
export type SemesterLength = 17 | 18 | 19;
export const SEMESTER_LENGTHS: SemesterLength[] = [17, 18, 19];

/** مواصفة المقرر كما تأتي من الخطة الرسمية. */
export interface CourseHours {
  /** س.أ — ساعات الاتصال الأسبوعية */
  cth: number;
  /** مح — ساعات المحاضرة النظرية أسبوعياً */
  l: number;
  /** عم — ساعات العملي/الورش أسبوعياً */
  p: number;
  /** تم — ساعات التمارين أسبوعياً */
  t?: number;
}

export type WeekKind =
  | 'teaching'
  | 'periodExam'
  | 'review'
  | 'finalPractical'
  | 'finalTheory'
  | 'finalCombined';

export interface SemesterWeek {
  /** رقم الأسبوع، أو أرقامه إن كان مدموجاً */
  numbers: number[];
  kind: WeekKind;
  /** ساعات نظرية في هذا الأسبوع (٠ لأسابيع الاختبار النهائي) */
  theoryHours: number;
  /** ساعات عملية في هذا الأسبوع */
  practicalHours: number;
  /** ترتيب اختبار الفترة (١ أو ٢) إن كان الأسبوع اختبار فترة */
  periodIndex?: 1 | 2;
  /**
   * الأسبوع يحمل الاختبار النهائي العملي إلى جانب محتواه (أسبوع ١٦ في
   * الطولين ١٧ و١٨ للمقرر المختلط — الذيل هناك لا يتسع لأسبوع عملي مستقل).
   */
  carriesPracticalFinal?: boolean;
}

export interface SemesterSkeleton {
  weeks: SemesterWeek[];
  /** مجموع الساعات الموزّعة فعلاً */
  totalHours: number;
  /** المعلن في الخطة = س.أ × ١٦ */
  declaredHours: number;
}

function validate(hours: CourseHours, length: SemesterLength): void {
  const { cth, l, p } = hours;
  if (!Number.isInteger(cth) || cth <= 0) {
    throw new RangeError(`س.أ يجب أن تكون عدداً صحيحاً موجباً، وردت: ${cth}`);
  }
  if (l < 0 || p < 0) {
    throw new RangeError(`مح وعم لا تقبلان السالب، وردت: مح=${l} عم=${p}`);
  }
  if (l + p !== cth) {
    throw new RangeError(
      `مح + عم يجب أن تساوي س.أ. وردت: ${l} + ${p} = ${l + p} بينما س.أ = ${cth}`,
    );
  }
  if (!SEMESTER_LENGTHS.includes(length)) {
    throw new RangeError(`طول الفصل يجب أن يكون ١٧ أو ١٨ أو ١٩، ورد: ${length}`);
  }
}

/**
 * يبني هيكل الفصل: ١٦ أسبوعاً تحمل الساعات، ثم أسابيع النهائي.
 * المقرر العملي فقط (مح=٠) لا نهائي نظري له، والعكس بالعكس.
 */
export function buildSemester(
  hours: CourseHours,
  length: SemesterLength,
): SemesterSkeleton {
  validate(hours, length);
  const { cth, l, p } = hours;

  const weeks: SemesterWeek[] = [];

  for (let n = 1; n <= TEACHING_WEEKS; n += 1) {
    const periodIdx = PERIOD_EXAM_WEEKS.indexOf(n as 7 | 13);
    const kind: WeekKind =
      periodIdx >= 0 ? 'periodExam' : n === REVIEW_WEEK ? 'review' : 'teaching';
    weeks.push({
      numbers: [n],
      kind,
      theoryHours: l,
      practicalHours: p,
      ...(periodIdx >= 0 ? { periodIndex: (periodIdx + 1) as 1 | 2 } : {}),
    });
  }

  const finalNumbers: number[] = [];
  for (let n = TEACHING_WEEKS + 1; n <= length; n += 1) finalNumbers.push(n);

  const hasTheory = l > 0;
  const hasPractical = p > 0;

  if (!hasTheory || !hasPractical) {
    // مقرر أحادي النمط: اختبار نهائي واحد يبتلع كل أسابيع النهائي.
    weeks.push({
      numbers: finalNumbers,
      kind: hasPractical ? 'finalPractical' : 'finalTheory',
      theoryHours: 0,
      practicalHours: 0,
    });
  } else if (finalNumbers.length >= 3) {
    // الذيل يتسع: أسبوع عملي مستقل ثم النظري مدموجاً في الأسبوعين الأخيرين.
    weeks.push({
      numbers: [finalNumbers[0]],
      kind: 'finalPractical',
      theoryHours: 0,
      practicalHours: 0,
    });
    weeks.push({
      numbers: finalNumbers.slice(1),
      kind: 'finalTheory',
      theoryHours: 0,
      practicalHours: 0,
    });
  } else {
    // الذيل ضيق (١٧/١٨): العملي داخل أسبوع التدريس الأخير، والذيل كله نظري.
    weeks[TEACHING_WEEKS - 1].carriesPracticalFinal = true;
    weeks.push({
      numbers: finalNumbers,
      kind: 'finalTheory',
      theoryHours: 0,
      practicalHours: 0,
    });
  }

  const totalHours = weeks.reduce(
    (sum, w) => sum + w.theoryHours + w.practicalHours,
    0,
  );

  return { weeks, totalHours, declaredHours: cth * TEACHING_WEEKS };
}

/** وحدة من الخطة الرسمية بساعاتها المعتمدة. */
export interface PlanUnit {
  title: string;
  hours: number;
}

/** حصة وحدة داخل أسبوع. */
export interface UnitSlice {
  unitIndex: number;
  title: string;
  hours: number;
}

export interface WeekAllocation {
  week: SemesterWeek;
  slices: UnitSlice[];
}

/**
 * يوزّع وحدات الخطة على الأسابيع الحاملة للساعات بالترتيب، فتُملأ كل أسبوع
 * بـ س.أ ساعة بالضبط. الوحدة قد تمتد على أكثر من أسبوع، والأسبوع قد يجمع
 * ذيل وحدة ورأس التي تليها — وهو ما تفعله الخطة الورقية ضمنياً.
 */
export function allocateUnits(
  units: PlanUnit[],
  skeleton: SemesterSkeleton,
  hours: CourseHours,
): WeekAllocation[] {
  const unitTotal = units.reduce((s, u) => s + u.hours, 0);
  if (unitTotal !== skeleton.declaredHours) {
    throw new RangeError(
      `مجموع ساعات الوحدات = ${unitTotal} ولا يساوي المعلن ` +
        `${skeleton.declaredHours} (س.أ ${hours.cth} × ${TEACHING_WEEKS})`,
    );
  }

  const bearing = skeleton.weeks.filter((w) => w.theoryHours + w.practicalHours > 0);
  const out: WeekAllocation[] = [];

  let unitIndex = 0;
  let remainingInUnit = units.length > 0 ? units[0].hours : 0;

  for (const week of bearing) {
    let capacity = week.theoryHours + week.practicalHours;
    const slices: UnitSlice[] = [];

    while (capacity > 0 && unitIndex < units.length) {
      if (remainingInUnit === 0) {
        unitIndex += 1;
        if (unitIndex >= units.length) break;
        remainingInUnit = units[unitIndex].hours;
        continue;
      }
      const take = Math.min(capacity, remainingInUnit);
      slices.push({ unitIndex, title: units[unitIndex].title, hours: take });
      capacity -= take;
      remainingInUnit -= take;
    }

    out.push({ week, slices });
  }

  return out;
}
