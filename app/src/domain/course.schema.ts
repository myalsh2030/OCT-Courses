import { z } from 'zod';

/**
 * مخطط ملف المقرر — العقد الوحيد بين المُنتِج (نحن) والمستهلك (النظام)
 * والمعدِّل (الزميل الذي يصدّر تعديله ثم يرفعه).
 *
 * كل ملف مرفوع يمرّ من هنا قبل أن يمسّ العرض، لأن الملف قد يأتي من جهاز زميل
 * وقد يكون معدّلاً بمحرر نصوص. الفشل هنا أرخص بكثير من جدول مكسور في PDF.
 */

export const SCHEMA_VERSION = 1;

const nonEmpty = z.string().trim().min(1, 'لا يجوز أن يكون فارغاً');

/* ───────────────────────── الخطة التدريبية ───────────────────────── */

/**
 * كل عمود في جدول الخطة عبارة عن خلايا ذات امتداد رأسي (rowspan).
 * تمثيلها كقائمة خلايا ممتدة — بدل صفوف مسطّحة — يجعل التحقق من سلامة
 * الجدول ممكناً قبل العرض، فلا تنكسر بنية <table> عند الطباعة.
 */
const span = z.number().int().positive('الامتداد يجب أن يكون ١ فأكثر');

const weekCell = z.object({ text: nonEmpty, span });
const unitCell = z.object({
  /** ترقيم الوحدة كما في النموذج، مثل «1 ـ 2». يغيب في صفوف الاختبارات. */
  code: z.string().trim().optional(),
  text: z.string(),
  span,
});
const hourCell = z.object({ value: z.number().int().nonnegative().nullable(), span });
const objectiveCell = z.object({ lines: z.array(z.string()), span });
/** الاستراتيجية وأداة التقييم قد تكونان فارغتين نصاً (أسابيع الاختبارات) لكنهما تشغلان الخلية. */
const textCell = z.object({ text: z.string(), span });
const gradeCell = z.object({ value: z.number().int().nonnegative().nullable(), span });

/** يتحقق أن خلايا العمود تغطي كل الصفوف بلا فجوة ولا تجاوز. */
function tiles(cells: { span: number }[], rowCount: number): boolean {
  return cells.reduce((sum, cell) => sum + cell.span, 0) === rowCount;
}

export const planWeekSchema = z
  .object({
    rowCount: z.number().int().positive(),
    week: z.array(weekCell).min(1),
    units: z.array(unitCell).min(1),
    hours: z.array(hourCell).min(1),
    objectives: z.array(objectiveCell).min(1),
    strategies: z.array(textCell).min(1),
    tools: z.array(textCell).min(1),
    grades: z.array(gradeCell).min(1),
  })
  .superRefine((wk, ctx) => {
    const columns = ['week', 'units', 'hours', 'objectives', 'strategies', 'tools', 'grades'] as const;
    for (const column of columns) {
      if (!tiles(wk[column], wk.rowCount)) {
        const total = wk[column].reduce((s, c) => s + c.span, 0);
        ctx.addIssue({
          code: 'custom',
          path: [column],
          message: `مجموع امتدادات العمود «${column}» = ${total} ولا يساوي عدد الصفوف ${wk.rowCount}`,
        });
      }
    }
  });

/* ───────────────────────── بقيّة الملف ───────────────────────── */

export const trainingTypeSchema = z.enum(['نظري', 'عملي', 'نظري وعملي', 'تعاوني']);

/** المدرب كما يرد من تقرير رايات SS01 — بلا بيانات تواصل، فتلك يُدخلها هو. */
export const courseTrainerSchema = z.object({
  trainerNo: z.string().regex(/^\d{7}$/, 'رقم المدرب سبعة أرقام'),
  name: nonEmpty,
  sections: z.array(z.string()).default([]),
});

export const referenceRowSchema = z.object({
  main: z.string().default(''),
  site: z.string().default(''),
  platform: z.string().default(''),
  mainUrl: z.url().optional(),
  siteUrl: z.url().optional(),
  platformUrl: z.url().optional(),
});

export const courseSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),

    /** المعرّف الثابت = الرمز الإنجليزي في الخطة المعتمدة، مثل MMIN-141. */
    id: z.string().regex(/^[A-Z]{2,5}-\d{3}$/, 'المعرّف مثل MMIN-141'),
    /** رمز رايات، مثل «مصيم-141». */
    rayatCode: nonEmpty,
    /** الرمز كما يُطبع في النموذج، مثل «141 مصيم». */
    displayCode: nonEmpty,
    name: nonEmpty,
    nameEn: z.string().default(''),

    creditHours: z.number().int().positive(),
    contactHours: z.number().int().positive(),
    lectureHours: z.number().int().nonnegative(),
    labHours: z.number().int().nonnegative(),
    trainingType: trainingTypeSchema,
    trainingMode: nonEmpty,
    level: z.number().int().positive(),
    prerequisite: z.string().default(''),

    description: nonEmpty,
    generalObjective: nonEmpty,
    objectives: z.object({
      knowledge: z.array(nonEmpty).min(1),
      procedural: z.array(nonEmpty).min(1),
    }),

    resources: z.string().default(''),
    equipment: z.array(nonEmpty).default([]),
    /** يُترك فارغاً ليرث تعليمات القسم؛ ويُملأ فقط عند الحاجة لتعليمات خاصة بالمقرر. */
    safetyInstructions: z.array(nonEmpty).default([]),

    plan: z.array(planWeekSchema).min(1),
    declaredTotalHours: z.number().int().positive(),
    declaredTotalGrades: z.number().int().positive(),

    references: z.array(referenceRowSchema).default([]),
    trainers: z.array(courseTrainerSchema).default([]),

    source: z.object({
      term: z.string().default(''),
      /** من أين جاءت البيانات: الخطة المعتمدة، تقرير رايات، أو إدخال يدوي. */
      origin: z.string().default(''),
      importedAt: z.string().default(''),
    }),
  })
  .superRefine((course, ctx) => {
    // مجموع الدرجات مُلزم: النموذج نفسه يعلن (100) درجة، وأي انحراف خطأ إدخال.
    // لا يُضرب في الامتداد: درجة تمتد على ثلاثة صفوف تبقى درجة واحدة.
    const sum = course.plan.reduce(
      (weekSum, wk) => weekSum + wk.grades.reduce((s, g) => s + (g.value ?? 0), 0),
      0,
    );
    if (sum !== course.declaredTotalGrades) {
      ctx.addIssue({
        code: 'custom',
        path: ['plan'],
        message: `مجموع درجات الأسابيع = ${sum} ولا يساوي المعلن ${course.declaredTotalGrades}`,
      });
    }

    if (course.lectureHours + course.labHours > course.contactHours) {
      ctx.addIssue({
        code: 'custom',
        path: ['contactHours'],
        message: 'ساعات المحاضرة + المختبر تتجاوز ساعات الاتصال',
      });
    }
  });

export type PlanWeek = z.infer<typeof planWeekSchema>;
export type CourseTrainer = z.infer<typeof courseTrainerSchema>;
export type ReferenceRow = z.infer<typeof referenceRowSchema>;
export type Course = z.infer<typeof courseSchema>;

/* ───────────────────────── واجهة التحقق ───────────────────────── */

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; course: Course; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * يتحقق من ملف مقرر قادم من مصدر غير موثوق (رفع مستخدم / ملف مصدَّر).
 * الأخطاء تمنع القبول، والتحذيرات تُعرض دون منع — كتفاوت ساعات التدريب
 * الذي يقع في النموذج الرسمي نفسه.
 */
export function parseCourse(input: unknown): ParseResult {
  const result = courseSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(الجذر)',
        message: issue.message,
      })),
    };
  }
  return { ok: true, course: result.data, warnings: collectWarnings(result.data) };
}

/** مجموع ساعات التدريب المعروضة في الخطة (القيمة المكتوبة في الخلية، لا مضروبة في امتدادها). */
export function sumPlanHours(course: Course): number {
  return course.plan.reduce(
    (weekSum, wk) => weekSum + wk.hours.reduce((s, h) => s + (h.value ?? 0), 0),
    0,
  );
}

function collectWarnings(course: Course): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];

  const hours = sumPlanHours(course);
  if (hours !== course.declaredTotalHours) {
    warnings.push({
      path: 'plan.hours',
      message: `مجموع ساعات الأسابيع = ${hours} بينما المعلن ${course.declaredTotalHours}`,
    });
  }

  if (course.trainers.length === 0) {
    warnings.push({ path: 'trainers', message: 'لا يوجد مدرب مسنَد لهذا المقرر' });
  }

  return warnings;
}
