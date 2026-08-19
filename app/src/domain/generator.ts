import catalogue from '../data/department/catalogue.json';
import planCourses from '../data/department/plan-courses.json';
import planDetail from '../data/department/plan-detail.json';
import type { Course, PlanWeek } from './course.schema';
import { SCHEMA_VERSION } from './course.schema';
import { EQUIPMENT_BY_COURSE } from './equipment';
import { embedPracticalFinal, finalPlanWeeks } from './planLength';
import { DEFAULT_REFERENCES } from './references';
import { SAFETY_BY_COURSE } from './safety';
import {
  allocateUnits,
  buildSemester,
  PERIOD_EXAM_WEEKS,
  REVIEW_WEEK,
  type CourseHours,
  type SemesterLength,
  type UnitSlice,
} from './semester';
import { arabicDigits, unitCode, weekOrdinal } from './vocab';

/**
 * مولّد ملف المقرر: من الخطة الرسمية المستخرجة إلى ملف Course كامل.
 *
 * ما يأتي من الخطة يُنقل حرفياً (الوحدات، الساعات، الوصف، الهدف)، والتجهيزات
 * منتقاة من ملاحقها في equipment.ts، والسلامة موحّدة تُورَّث من القسم.
 * وما لا تنص عليه الخطة يُؤلَّف هنا بقواعد حتمية معلنة — الأهداف الأسبوعية
 * والاستراتيجيات والأدوات وتوزيع الدرجات — ثم يحرّره المدرب في الواجهة.
 *
 * تنسيق الجدول مبسّط عمداً (خيار المالك): الساعات والاستراتيجية والأداة
 * والدرجة خلية واحدة ممتدة لكل أسبوع، والتفصيل يبقى في المواضيع والأهداف.
 *
 * توزيع الدرجات المئة (يطابق نموذج الموائع المعتمد):
 *   فترتان ٢٠+٢٠ في الأسبوعين ٧ و١٣، وتقييمات أسبوعية مجموعها ٢٠،
 *   واختبار نهائي ٤٠ (عملي ١٣ + نظري ٢٧ للمقرر المختلط، أو ٤٠ لأحاديّ النمط).
 */

const WEEKLY_POOL = 20;
const PERIOD_EXAM_GRADE = 20;

/**
 * أقصى عدد أهداف في كل قسم (معرفية/إجرائية). الخطة قد تقسّم المقرر إلى
 * إحدى عشرة وحدة صغيرة (علم المواد مثلاً)، وهدفٌ لكل وحدة يُفيض صفحة
 * الأهداف عن الورقة ويُثقلها على القارئ — فتُدمج أصغر الوحدات المتجاورة
 * في هدف واحد حتى يبلغ العدد هذا الحد.
 */
const MAX_OBJECTIVES = 6;

/** يدمج أصغر وحدتين متجاورتين تكراراً حتى يبلغ العدد الحد الأقصى. */
function objectiveTitles(units: { title: string; hours: number }[], max = MAX_OBJECTIVES): string[] {
  const list = units.map((u) => ({ title: u.title, hours: u.hours }));
  while (list.length > max) {
    let best = 0;
    for (let i = 1; i < list.length - 1; i += 1) {
      if (list[i].hours + list[i + 1].hours < list[best].hours + list[best + 1].hours) {
        best = i;
      }
    }
    list.splice(best, 2, {
      title: `${list[best].title} و${list[best + 1].title}`,
      hours: list[best].hours + list[best + 1].hours,
    });
  }
  return list.map((u) => u.title);
}

/* ───────────────────── مصادر البيانات ───────────────────── */

type CatalogueCourse = (typeof catalogue.courses)[number];
type PlanCourse = (typeof planCourses.courses)[number];
type DetailCourse = (typeof planDetail.courses)[number];

function findSources(code: string): {
  meta: CatalogueCourse;
  plan: PlanCourse;
  detail: DetailCourse;
} {
  const meta = catalogue.courses.find((c) => c.code === code);
  const plan = planCourses.courses.find((c) => c.code === code);
  const detail = planDetail.courses.find((c) => c.code === code);
  if (!meta || !plan || !detail) {
    throw new Error(`المقرر ${code} غير مكتمل المصادر (كتالوج/خطة/منهج تفصيلي)`);
  }
  return { meta, plan, detail };
}

/* ───────────────────── تأليف النصوص ───────────────────── */

/** مصادر شائعة تبدأ بها بنود «المنهج التفصيلي» — تُصاغ حولها الأهداف. */
const MASDAR_PREFIXES = [
  'تطبيق', 'تنفيذ', 'كتابة', 'حساب', 'رسم', 'فك', 'تركيب', 'فحص', 'قياس',
  'تشخيص', 'صيانة', 'رفع', 'تحديد', 'تعيين', 'شرح', 'استخدام', 'اختيار',
  'ضبط', 'تشغيل', 'مقارنة', 'تفسير', 'معايرة', 'تجهيز', 'توصيل', 'اختبار',
];

const THEORY_VERBS = ['يشرح', 'يوضح', 'يتعرف على', 'يصف'];

function startsWithMasdar(topic: string): boolean {
  return MASDAR_PREFIXES.some((m) => topic.startsWith(m));
}

function theoryObjective(topic: string, seq: number): string {
  if (startsWithMasdar(topic)) return `يجيد ${topic}.`;
  return `${THEORY_VERBS[seq % THEORY_VERBS.length]} ${topic}.`;
}

function practicalObjective(topic: string): string {
  if (startsWithMasdar(topic)) return `يتقن ${topic} عملياً.`;
  return `يطبق ${topic} عملياً.`;
}

/* ───────────────────── طوابير المواضيع ───────────────────── */

/**
 * طابور مواضيع كتلة واحدة. مجموعة «المستعمَل» مشتركة على مستوى المقرر
 * كله فلا يظهر الموضوع نفسه مرتين أبداً — لا في الأسبوع الواحد ولا عبر
 * الأسابيع (قاعدة المالك ٢٠٢٦-٠٧-٢٩). عند نفاد النوع المطلوب يُستعار من
 * النوع الآخر بصياغة مناسبة، وعند نفاد الاثنين يُؤلَّف نص احتياطي فريد
 * من عنوان الكتلة — فلا يظهر أسبوع بلا موضوع أبداً.
 */
class TopicQueue {
  private blockTitle: string;
  private theory: string[];
  private practical: string[];
  private used: Set<string>;
  private fallbacks = { theory: 0, practical: 0 };

  constructor(
    blockTitle: string,
    theory: string[],
    practical: string[],
    used: Set<string>,
  ) {
    this.blockTitle = blockTitle;
    this.theory = [...theory];
    this.practical = [...practical];
    this.used = used;
  }

  /** يسحب أول موضوع لم يُستعمل بعد، أو null عند النفاد. */
  private take(list: string[]): string | null {
    while (list.length > 0) {
      const topic = list.shift()!.trim();
      if (topic && !this.used.has(topic)) {
        this.used.add(topic);
        return topic;
      }
    }
    return null;
  }

  next(kind: 'theory' | 'practical'): string {
    const own = kind === 'theory' ? this.theory : this.practical;
    const other = kind === 'theory' ? this.practical : this.theory;

    const fromOwn = this.take(own);
    if (fromOwn) return fromOwn;

    const borrowed = this.take(other);
    if (borrowed) {
      if (kind !== 'practical') return borrowed;
      const applied = `تطبيقات عملية على ${borrowed}`;
      this.used.add(applied);
      return applied;
    }

    for (;;) {
      this.fallbacks[kind] += 1;
      const n = this.fallbacks[kind];
      const base =
        kind === 'practical' ? `تدريبات عملية على ${this.blockTitle}` : this.blockTitle;
      const candidate =
        n === 1 ? base : n === 2 ? `${base} (تتمة)` : `${base} (تتمة ${arabicDigits(n - 1)})`;
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        return candidate;
      }
    }
  }
}

/* ───────────────────── توزيع الدرجات ───────────────────── */

/**
 * يوزّع رصيد التقييمات الأسبوعية (٢٠) على الأسابيع غير الاختبارية توزيعاً
 * حتمياً: درجة أساس لكل أسبوع، والباقي يُمنح درجةً إضافية بالتناوب.
 */
export function distributeWeeklyGrades(weekCount: number, pool = WEEKLY_POOL): number[] {
  if (weekCount <= 0) return [];
  const base = Math.floor(pool / weekCount);
  let remainder = pool - base * weekCount;
  const grades = Array.from({ length: weekCount }, () => base);
  for (let i = 1; i < weekCount && remainder > 0; i += 2) {
    grades[i] += 1;
    remainder -= 1;
  }
  // إن بقي شيء (أسابيع قليلة) يُصرف من البداية
  for (let i = 0; i < weekCount && remainder > 0; i += 2) {
    grades[i] += 1;
    remainder -= 1;
  }
  return grades;
}

/* ───────────────────── بناء أسابيع الخطة ───────────────────── */

interface WeekRow {
  kind: 'theory' | 'practical';
  blockIndex: number;
  hours: number;
  topic: string;
}

function buildWeekRows(
  slices: UnitSlice[],
  hours: CourseHours,
  queues: TopicQueue[],
): WeekRow[] {
  const rows: WeekRow[] = [];
  let theoryLeft = hours.l;
  for (const slice of slices) {
    let remaining = slice.hours;
    const theoryTake = Math.min(remaining, theoryLeft);
    if (theoryTake > 0) {
      rows.push({
        kind: 'theory',
        blockIndex: slice.unitIndex,
        hours: theoryTake,
        topic: queues[slice.unitIndex].next('theory'),
      });
      theoryLeft -= theoryTake;
      remaining -= theoryTake;
    }
    if (remaining > 0) {
      rows.push({
        kind: 'practical',
        blockIndex: slice.unitIndex,
        hours: remaining,
        topic: queues[slice.unitIndex].next('practical'),
      });
    }
  }
  return rows;
}

/** استراتيجية النظري تُناوب بين أساليب المفردات؛ والعملي «التطبيق العملي» دائماً. */
const THEORY_STRATEGY_CYCLE = [
  'المحاضرة النظرية',
  'العصف الذهني',
  'التدريب بالاكتشاف',
  'حل المشكلات',
  'المحاضرة النظرية',
  'دراسة الحالة',
  'التدريب بالمحاكاة',
  'العمل الجماعي',
  'المحاضرة النظرية',
  'التدريب البنائي',
];

function weeklyToolCycle(hours: CourseHours): string[] {
  const cycle = ['واجب'];
  if (hours.p > 0) cycle.push('تقييم عملي');
  cycle.push('اختبار قصير');
  cycle.push(hours.l > 0 ? 'تقييم نظري' : 'تقرير عملي');
  return cycle;
}

/* ───────────────────── المولّد ───────────────────── */

export interface GenerateOptions {
  semesterLength?: SemesterLength;
  /** طابع زمني يُحقن من الخارج — لا يُستدعى Date.now هنا حفاظاً على الحتمية. */
  generatedAt?: string;
}

export function generateCourse(code: string, options: GenerateOptions = {}): Course {
  const { semesterLength = 19, generatedAt = '' } = options;
  const { meta, plan, detail } = findSources(code);

  if (meta.cth == null || meta.l == null || meta.p == null) {
    throw new Error(`المقرر ${code} بلا ساعات معتمدة (تدريب تعاوني؟) — لا يولَّد له ملف`);
  }
  const hours: CourseHours = { cth: meta.cth, l: meta.l, p: meta.p, t: meta.t ?? 0 };

  const skeleton = buildSemester(hours, semesterLength);
  const blocks = detail.units.map((u) => ({ title: u.title, hours: u.hours }));
  const alloc = allocateUnits(blocks, skeleton, hours);
  const usedTopics = new Set<string>();
  const queues = detail.units.map(
    (u) => new TopicQueue(u.title, u.theory, u.practical, usedTopics),
  );

  // الدرجات الأسبوعية: لكل أسبوع تدريس عدا أسبوعي اختبار الفترة
  const gradedWeeks = alloc.filter((a) => a.week.kind !== 'periodExam');
  const weeklyGrades = distributeWeeklyGrades(gradedWeeks.length);
  const gradeByWeek = new Map<number, number>();
  gradedWeeks.forEach((a, i) => gradeByWeek.set(a.week.numbers[0], weeklyGrades[i]));

  const planWeeks: PlanWeek[] = [];
  let theorySeq = 0;

  for (const a of alloc) {
    const weekNo = a.week.numbers[0];
    const rows = buildWeekRows(a.slices, hours, queues);
    const isPeriodExam = a.week.kind === 'periodExam';
    const isReview = weekNo === REVIEW_WEEK;
    const examIndex = isPeriodExam ? PERIOD_EXAM_WEEKS.indexOf(weekNo as 7 | 13) + 1 : 0;

    const rowCount = rows.length + (isPeriodExam ? 1 : 0);
    const objectiveLines = rows.map((r, i) => {
      const line =
        r.kind === 'theory'
          ? theoryObjective(r.topic, theorySeq++)
          : practicalObjective(r.topic);
      return `${i + 1}. ${line}`;
    });
    if (isPeriodExam) {
      objectiveLines.push(`${rows.length + 1}. يطبق المهارات السابقة بشكل صحيح.`);
    }
    if (isReview) {
      objectiveLines.push(
        `${objectiveLines.length + 1}. يسترجع المهارات المكتسبة استعداداً للاختبار النهائي.`,
      );
    }

    // خلية استراتيجية واحدة للأسبوع كله (تنسيق مبسّط): أسلوب النظري من
    // الدورة، ويُلحق «والتطبيق العملي» متى كان في الأسبوع جانب عملي.
    const hasTheory = rows.some((r) => r.kind === 'theory');
    const hasPractical = rows.some((r) => r.kind === 'practical');
    const theoryStrategy = THEORY_STRATEGY_CYCLE[(weekNo - 1) % THEORY_STRATEGY_CYCLE.length];
    const weekStrategy = !hasTheory
      ? 'التطبيق العملي'
      : hasPractical
        ? `${theoryStrategy} والتطبيق العملي`
        : theoryStrategy;

    const toolCycle = weeklyToolCycle(hours);
    const weeklyTool = isPeriodExam
      ? `اختبار ( ${examIndex} )`
      : isReview
        ? hours.l > 0
          ? 'تقييم نظري'
          : 'تقييم عملي'
        : toolCycle[(weekNo - 1) % toolCycle.length];

    const weekHours = rows.reduce((sum, r) => sum + r.hours, 0);

    const week: PlanWeek = {
      rowCount,
      week: [{ text: weekOrdinal(weekNo), span: rowCount }],
      units: [
        ...rows.map((r, i) => ({
          code: unitCode(weekNo, i + 1),
          text: isReview && i === rows.length - 1 ? `${r.topic} ومراجعة عامة للمقرر.` : r.topic,
          span: 1,
        })),
        ...(isPeriodExam
          ? [{ text: `اختبار الفترة (${arabicDigits(examIndex)})`, span: 1 }]
          : []),
      ],
      hours: [{ value: weekHours, span: rowCount }],
      objectives: [{ lines: objectiveLines, span: rowCount }],
      strategies: [{ text: weekStrategy, span: rowCount }],
      tools: [{ text: weeklyTool, span: rowCount }],
      grades: [
        {
          value: isPeriodExam ? PERIOD_EXAM_GRADE : (gradeByWeek.get(weekNo) ?? 0),
          span: rowCount,
        },
      ],
    };
    planWeeks.push(week);
  }

  // في الطولين ١٧ و١٨ يدخل الاختبار العملي أسبوعَ التدريس الأخير
  if (skeleton.weeks.some((w) => w.carriesPracticalFinal)) {
    planWeeks[planWeeks.length - 1] = embedPracticalFinal(planWeeks[planWeeks.length - 1]);
  }
  planWeeks.push(...finalPlanWeeks(hours, semesterLength));

  /* ───────── بقية الملف ───────── */

  const family = meta.codeAr.split(' ').at(-1) ?? '';
  const digits = code.split(' ')[1];
  const trainingType: Course['trainingType'] =
    hours.l > 0 && hours.p > 0 ? 'نظري وعملي' : hours.l > 0 ? 'نظري' : 'عملي';

  const course: Course = {
    schemaVersion: SCHEMA_VERSION,
    id: code.replace(' ', '-'),
    rayatCode: `${family}-${digits}`,
    displayCode: `${digits} ${family}`,
    name: meta.nameAr,
    nameEn: meta.nameEn,

    creditHours: meta.crh ?? 0,
    contactHours: hours.cth,
    lectureHours: hours.l,
    labHours: hours.p,
    trainingType,
    trainingMode: 'تدريب حضوري',
    level: meta.semester,
    prerequisite: meta.prereqAr.join(' ، '),

    description: plan.description,
    generalObjective: plan.generalObjective.replace(/^:\s*/, ''),
    objectives: {
      knowledge: objectiveTitles(plan.units).map((t) => `الإلمام بأساسيات ${t}.`),
      procedural: objectiveTitles(plan.units).map(
        (t) => `أداء التطبيقات العملية على ${t} بشكل صحيح.`,
      ),
    },

    resources:
      'قاعة تدريبية، مقاعد قابلة لإعادة التشكيل، حاسب آلي، جهاز عرض، عروض تقديمية، منصة إدارة تعلم (LMS)، محتوى ومواد تعليمية، مكتبة الكترونية، سبورة وأقلام ملونة.',
    equipment: EQUIPMENT_BY_COURSE[code] ?? [],
    // اشتراطات سلامة خاصة بالمقرر من أخطاره الفعلية (قرار المالك
    // ٢٠٢٦-٠٨-٠٢). إفراغها في الواجهة يعيد النص العام في department.ts.
    safetyInstructions: SAFETY_BY_COURSE[code] ?? [],

    plan: planWeeks,
    declaredTotalHours: hours.cth * 16,
    declaredTotalGrades: 100,

    references: structuredClone(DEFAULT_REFERENCES),
    trainers: [],

    source: {
      term: '',
      origin: `الخطة التدريبية المعتمدة ١٤٤٦هـ (ص ${plan.pageStart}–${plan.pageEnd}) + توليد آلي للأسابيع`,
      importedAt: generatedAt,
    },
  };

  return course;
}

/** المقررات القابلة للتوليد (ذات تفاصيل في الخطة). */
export function generatableCourses(): string[] {
  return planDetail.courses.map((c) => c.code);
}
