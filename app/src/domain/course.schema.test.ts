import { describe, expect, it } from 'vitest';
// النسخة المجمّدة المطابقة للوثيقة الورقية — ملفات data/courses تُعاد
// كتابتها بالمولّد، بينما هذه الاختبارات توصّف الوثيقة المرجعية بعينها.
import referenceCourse from '../test/fixtures/MMIN-141.reference.json';
import { IndexedDbAdapter } from '../storage';
import { buildingFromOffice } from './department';
import { parseCourse, sumPlanHours, type Course } from './course.schema';

/** نسخة عميقة قابلة للعبث بها دون تلويث الملف المرجعي بين الاختبارات. */
function clone(): Record<string, unknown> {
  return structuredClone(referenceCourse) as Record<string, unknown>;
}

function mustParse(): Course {
  const result = parseCourse(referenceCourse);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.course;
}

describe('الملف المرجعي MMIN-141', () => {
  it('يجتاز التحقق', () => {
    const result = parseCourse(referenceCourse);
    if (!result.ok) console.error(result.issues);
    expect(result.ok).toBe(true);
  });

  it('يطابق بيانات الخطة المعتمدة وتقرير رايات', () => {
    const course = mustParse();
    expect(course.id).toBe('MMIN-141');
    expect(course.rayatCode).toBe('مصيم-141');
    expect(course.creditHours).toBe(3);
    expect(course.contactHours).toBe(4);
    expect(course.lectureHours).toBe(2);
    expect(course.labHours).toBe(2);
    expect(course.trainingType).toBe('نظري وعملي');
    expect(course.prerequisite).toBe('101 فيزي');
    expect(course.trainers[0].trainerNo).toBe('0013270');
  });

  it('يحوي ١٨ كتلة أسبوع تغطي ١٩ أسبوعاً', () => {
    const course = mustParse();
    expect(course.plan).toHaveLength(18);
    const weekLabels = course.plan.flatMap((wk) => wk.week.map((c) => c.text));
    expect(weekLabels).toHaveLength(19);
    expect(weekLabels[0]).toBe('الأول');
    expect(weekLabels.at(-1)).toBe('التاسع عشر');
  });

  it('مجموع الدرجات ١٠٠ بالضبط', () => {
    const course = mustParse();
    const sum = course.plan.reduce(
      (t, wk) => t + wk.grades.reduce((s, g) => s + (g.value ?? 0), 0),
      0,
    );
    expect(sum).toBe(100);
  });

  it('خمسة أهداف معرفية وخمسة إجرائية وسبعة أجهزة', () => {
    const course = mustParse();
    expect(course.objectives.knowledge).toHaveLength(5);
    expect(course.objectives.procedural).toHaveLength(5);
    expect(course.equipment).toHaveLength(7);
  });

  it('يترك تعليمات السلامة فارغة ليرثها من القسم', () => {
    expect(mustParse().safetyInstructions).toEqual([]);
  });

  it('ينبّه لتفاوت الساعات الوارد في النموذج الأصلي (٨٨ مقابل ٦٤ معلنة)', () => {
    const result = parseCourse(referenceCourse);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sumPlanHours(result.course)).toBe(88);
    expect(result.warnings.map((w) => w.path)).toContain('plan.hours');
  });

  it('لا ينبّه لغياب المدرب', () => {
    const result = parseCourse(referenceCourse);
    if (!result.ok) throw new Error('فشل التحقق');
    expect(result.warnings.map((w) => w.path)).not.toContain('trainers');
  });
});

describe('اشتقاق المبنى من رقم المكتب', () => {
  it('الخانتان الرابعة والخامسة من اليسار', () => {
    expect(buildingFromOffice('1350610108')).toBe('06');
    expect(buildingFromOffice('1350630301')).toBe('06');
    expect(buildingFromOffice('1352110112')).toBe('21'); // مبنى الورش
    expect(buildingFromOffice('1350230339')).toBe('02');
  });

  it('يتجاهل الفراغات والرموز، ويعيد فارغاً للرقم القصير', () => {
    expect(buildingFromOffice(' 1350 610 108 ')).toBe('06');
    expect(buildingFromOffice('123')).toBe('');
    expect(buildingFromOffice('')).toBe('');
  });
});

describe('رفض الملفات المعطوبة', () => {
  function expectRejected(mutate: (c: Record<string, any>) => void, pathFragment: string) {
    const bad = clone();
    mutate(bad);
    const result = parseCourse(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path.includes(pathFragment))).toBe(true);
  }

  it('يرفض امتداداً لا يغطي كل الصفوف (rowspan مكسور)', () => {
    // كسر عمود الاستراتيجية في الأسبوع الأول: 2+1 تصبح 2 فقط
    expectRejected((c) => c.plan[0].strategies.pop(), 'strategies');
  });

  it('يرفض امتداداً يتجاوز عدد الصفوف', () => {
    expectRejected((c) => (c.plan[0].tools[0].span = 5), 'tools');
  });

  it('يرفض مجموع درجات لا يطابق المعلن', () => {
    expectRejected((c) => (c.plan[0].grades[0].value = 9), 'plan');
  });

  it('يرفض معرّفاً بغير نمط الخطة المعتمدة', () => {
    expectRejected((c) => (c.id = 'مصيم-141'), 'id');
  });

  it('يرفض رقم مدرب بغير سبعة أرقام', () => {
    expectRejected((c) => (c.trainers[0].trainerNo = '13270'), 'trainerNo');
  });

  it('يرفض ساعات محاضرة ومختبر تتجاوز ساعات الاتصال', () => {
    expectRejected((c) => (c.lectureHours = 4), 'contactHours');
  });

  it('يرفض نسخة مخطط غير مدعومة', () => {
    expectRejected((c) => (c.schemaVersion = 2), 'schemaVersion');
  });

  it('يرفض اسم مقرر فارغ', () => {
    expectRejected((c) => (c.name = '   '), 'name');
  });

  it('يرفض غياب الخطة كلياً', () => {
    expectRejected((c) => (c.plan = []), 'plan');
  });

  it('يرفض قيمة غير معروفة لنوع التدريب', () => {
    expectRejected((c) => (c.trainingType = 'ورشة'), 'trainingType');
  });
});

describe('دورة كاملة عبر محوّل التخزين', () => {
  it('يُحفظ في IndexedDB ويُسترجع فيجتاز التحقق مجدداً', async () => {
    const storage = new IndexedDbAdapter(`course-${Math.random().toString(36).slice(2)}`);
    await storage.init();

    const parsed = mustParse();
    await storage.put('courses', parsed);

    const back = await storage.get<Course>('courses', 'MMIN-141');
    expect(back).toBeDefined();
    expect(parseCourse(back).ok).toBe(true);
    expect(back).toEqual(parsed);

    // الفهارس الحقيقية للمقررات: رمز رايات والمستوى
    expect(await storage.findBy<Course>('courses', 'rayatCode', 'مصيم-141')).toHaveLength(1);
    expect(await storage.findBy<Course>('courses', 'level', 2)).toHaveLength(1);
    expect(await storage.findBy<Course>('courses', 'level', 5)).toHaveLength(0);

    await storage.close();
  });
});
