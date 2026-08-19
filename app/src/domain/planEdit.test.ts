import { describe, expect, it } from 'vitest';
import { parseCourse, type Course } from './course.schema';
import { generateCourse } from './generator';
import { addUnitRow, contentRowCount, isContentRow, removeUnitRow, setUnitTopic } from './planEdit';

/**
 * جراحة صفوف المواضيع يجب أن تُبقي الجدول سليماً بمعيار المخطط نفسه
 * (امتدادات كل عمود = عدد الصفوف) وألا تمسّ صفوف الاختبارات ولا الدرجات.
 */

function fresh(): Course {
  return structuredClone(generateCourse('MMIN 141'));
}

function gradesSum(course: Course): number {
  return course.plan.reduce(
    (s, w) => s + w.grades.reduce((x, g) => x + (g.value ?? 0), 0),
    0,
  );
}

describe('تعديل موضوع', () => {
  it('يغيّر نص صف المحتوى ويترك صف الاختبار', () => {
    const c = fresh();
    setUnitTopic(c.plan[0], 0, 'موضوع معدَّل يدوياً');
    expect(c.plan[0].units[0].text).toBe('موضوع معدَّل يدوياً');

    const examWeek = c.plan[6]; // الأسبوع ٧: آخر صفوفه صف اختبار الفترة
    const examRow = examWeek.units.length - 1;
    const before = examWeek.units[examRow].text;
    setUnitTopic(examWeek, examRow, 'محاولة عبث');
    expect(examWeek.units[examRow].text).toBe(before);
  });
});

describe('إضافة صف موضوع', () => {
  it('يضيف قبل صف الاختبار ويحافظ على سلامة الجدول والدرجات', () => {
    const c = fresh();
    const week = c.plan[6]; // أسبوع اختبار فترة — أصعب حالة
    const rowsBefore = week.rowCount;
    const contentBefore = contentRowCount(week);

    addUnitRow(week);

    expect(week.rowCount).toBe(rowsBefore + 1);
    expect(contentRowCount(week)).toBe(contentBefore + 1);
    // صف الاختبار بقي الأخير بلا ترقيم
    expect(week.units.at(-1)!.code).toBeUndefined();
    expect(week.units.at(-1)!.text).toContain('اختبار الفترة');
    // الصف الجديد قبله مباشرة ومرقّم بالهندية
    expect(week.units.at(-2)!.text).toBe('موضوع جديد');
    expect(week.units.at(-2)!.code).toMatch(/^[٠-٩]+ ـ [٠-٩]+$/);

    const parsed = parseCourse(c);
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.issues)).toBe(true);
    expect(gradesSum(c)).toBe(100);
  });

  it('لا يضيف لأسبوع نهائي (كل صفوفه بلا ترقيم)', () => {
    const c = fresh();
    const final = c.plan.find((w) => w.units[0].text.startsWith('اختبار نهائي'))!;
    const rows = final.rowCount;
    addUnitRow(final);
    expect(final.rowCount).toBe(rows);
  });
});

describe('حذف صف موضوع', () => {
  it('يحذف ويعيد الترقيم ويحافظ على سلامة الجدول', () => {
    const c = fresh();
    const week = c.plan[0];
    const rowsBefore = week.rowCount;
    const secondTopic = week.units[1]?.text;

    expect(removeUnitRow(week, 0)).toBe(true);
    expect(week.rowCount).toBe(rowsBefore - 1);
    // الصف التالي صار الأول وترقيمه «١ ـ ١»
    expect(week.units[0].text).toBe(secondTopic);
    expect(week.units[0].code).toBe('١ ـ ١');

    const parsed = parseCourse(c);
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.issues)).toBe(true);
    expect(gradesSum(c)).toBe(100);
  });

  it('يرفض حذف صف الاختبار وآخر صف محتوى', () => {
    const c = fresh();
    const examWeek = c.plan[6];
    expect(removeUnitRow(examWeek, examWeek.units.length - 1)).toBe(false);

    const week = c.plan[0];
    while (contentRowCount(week) > 1) {
      expect(removeUnitRow(week, 0)).toBe(true);
    }
    expect(removeUnitRow(week, 0)).toBe(false); // الأخير محمي
    expect(parseCourse(c).ok).toBe(true);
  });
});

describe('إضافة ثم حذف = العودة لبنية سليمة متطابقة الصفوف', () => {
  it('دورة كاملة على كل أسابيع التدريس', () => {
    const c = fresh();
    for (const [i, week] of c.plan.entries()) {
      if (week.units[0].text.startsWith('اختبار نهائي')) continue;
      const rows = week.rowCount;
      addUnitRow(week);
      expect(removeUnitRow(week, contentRowCount(week) - 1), `أسبوع ${i + 1}`).toBe(true);
      expect(week.rowCount, `أسبوع ${i + 1}`).toBe(rows);
    }
    const parsed = parseCourse(c);
    expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.issues)).toBe(true);
  });
});

describe('isContentRow', () => {
  it('يميّز صفوف المحتوى عن صفوف الاختبارات', () => {
    const c = fresh();
    expect(isContentRow(c.plan[0], 0)).toBe(true);
    const examWeek = c.plan[6];
    expect(isContentRow(examWeek, examWeek.units.length - 1)).toBe(false);
  });
});
