import { describe, expect, it } from 'vitest';
import { parseCourse, sumPlanHours, type Course } from './course.schema';
import { generateCourse } from './generator';
import { adaptCourseLength, isFinalWeek } from './planLength';
import { SEMESTER_LENGTHS } from './semester';

/**
 * تحويل طول الفصل وقتَ العرض: المخزَّن قانوني بطول ١٩، والتحويل يستبدل
 * أسابيع النهائي فقط. هذه الاختبارات تثبت أنه لا يفسد شيئاً آخر.
 */

const canonical: Course = generateCourse('MMIN 141', { semesterLength: 19 });

describe('تكييف طول الفصل', () => {
  for (const length of SEMESTER_LENGTHS) {
    it(`إلى ${length}: يبقى الملف صالحاً بالمخطط وثوابته`, () => {
      const adapted = adaptCourseLength(canonical, length);
      const result = parseCourse(adapted);
      expect(result.ok, JSON.stringify(!result.ok && result.issues)).toBe(true);
      expect(sumPlanHours(adapted)).toBe(canonical.contactHours * 16);
    });
  }

  it('التحويل يطابق التوليد المباشر بنفس الطول حرفياً', () => {
    for (const length of SEMESTER_LENGTHS) {
      const adapted = adaptCourseLength(canonical, length);
      const direct = generateCourse('MMIN 141', { semesterLength: length });
      expect(JSON.stringify(adapted.plan)).toBe(JSON.stringify(direct.plan));
    }
  });

  it('تعديلات المدرب على أسابيع التدريس تنجو من التحويل', () => {
    const edited = structuredClone(canonical);
    edited.plan[4].objectives = [{ lines: ['1. هدف عدّله المدرب.'], span: edited.plan[4].rowCount }];
    edited.plan[4].strategies[0].text = 'العصف الذهني';

    const adapted = adaptCourseLength(edited, 17);
    expect(adapted.plan[4].objectives[0].lines).toEqual(['1. هدف عدّله المدرب.']);
    expect(adapted.plan[4].strategies[0].text).toBe('العصف الذهني');
  });

  it('التحويل ذهاباً وإياباً يعيد الخطة الأصلية', () => {
    const roundTrip = adaptCourseLength(adaptCourseLength(canonical, 17), 19);
    expect(JSON.stringify(roundTrip.plan)).toBe(JSON.stringify(canonical.plan));
  });

  it('يميّز أسابيع النهائي بدقة', () => {
    const finals = canonical.plan.filter(isFinalWeek);
    expect(finals).toHaveLength(2);
    expect(canonical.plan.filter((w) => !isFinalWeek(w))).toHaveLength(16);
  });

  it('لا يلمس الملف الأصلي (نقاء الدالة)', () => {
    const before = JSON.stringify(canonical);
    adaptCourseLength(canonical, 17);
    expect(JSON.stringify(canonical)).toBe(before);
  });
});
