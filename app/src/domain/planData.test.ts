import { describe, expect, it } from 'vitest';
import catalogue from '../data/department/catalogue.json';
import plan from '../data/department/plan-courses.json';
import { allocateUnits, buildSemester, SEMESTER_LENGTHS, TEACHING_WEEKS } from './semester';

/**
 * بيانات المقررات مستخرجة آلياً من الخطة الرسمية، ونصّها العربي مُصلَح
 * بقاعدة «الحرف صفري العرض يسبقه حامله». هذه الاختبارات هي شبكة الأمان:
 * أي انحراف في الاستخراج يظهر هنا قبل أن يصل إلى وثيقة مطبوعة.
 */

const cat = new Map(catalogue.courses.map((c) => [c.code, c]));
const courses = plan.courses;

describe('بيانات الخطة المستخرجة', () => {
  // مقررات القسم التخصصية: تسعة «مصيم» من خطة الصيانة، وستة «منتج» من
  // خطة التصنيع (التدريب التعاوني ٢٩٩ بلا ساعات فلا خطة أسبوعية له).
  it('تغطي مقررات القسم التخصصية الخمسة عشر بلا تكرار', () => {
    expect(courses).toHaveLength(15);
    expect(new Set(courses.map((c) => c.code)).size).toBe(15);
    expect(courses.filter((c) => c.code.startsWith('MMEC'))).toHaveLength(6);
  });

  it('كل مقرر موجود في كتالوج القسم', () => {
    for (const c of courses) expect(cat.has(c.code), c.code).toBe(true);
  });

  describe('الثابت: مجموع ساعات الوحدات = س.أ × ١٦', () => {
    for (const c of courses) {
      it(`${c.code} — ${c.nameAr}`, () => {
        const expected = cat.get(c.code)!.cth! * TEACHING_WEEKS;
        const sum = c.units.reduce((s, u) => s + u.hours, 0);
        expect(sum, `مجموع وحدات ${c.code}`).toBe(expected);
        expect(c.cth).toBe(cat.get(c.code)!.cth);
      });
    }
  });

  it('س.أ في الخطة يطابق س.أ في الكتالوج', () => {
    for (const c of courses) expect(c.cth, c.code).toBe(cat.get(c.code)!.cth);
  });

  it('لا وحدة بلا عنوان أو بساعات غير موجبة', () => {
    for (const c of courses) {
      expect(c.units.length, c.code).toBeGreaterThan(0);
      for (const u of c.units) {
        expect(u.title.trim().length, `${c.code}: عنوان فارغ`).toBeGreaterThan(2);
        expect(u.hours, `${c.code}: ${u.title}`).toBeGreaterThan(0);
      }
    }
  });

  it('النص العربي سليم — لا آثار رباطات مقلوبة معروفة', () => {
    // «امجلموع» و«الحمتوى» و«السالمة» علامات فشل التصحيح
    const bad = ['امجل', 'الحمت', 'اجملم', 'املقرر', 'امليكان', 'السالمة', 'اإلدارة'];
    for (const c of courses) {
      const blob = [c.description, c.generalObjective, ...c.safety,
        ...c.units.map((u) => u.title)].join(' ');
      for (const b of bad) {
        expect(blob.includes(b), `${c.code} يحوي «${b}»`).toBe(false);
      }
    }
  });

  it('لكل مقرر وصف وهدف عام واشتراطات سلامة', () => {
    for (const c of courses) {
      expect(c.description.length, `${c.code}: وصف`).toBeGreaterThan(40);
      expect(c.generalObjective.length, `${c.code}: هدف`).toBeGreaterThan(20);
      expect(c.safety.length, `${c.code}: سلامة`).toBeGreaterThan(0);
    }
  });
});

describe('توزيع وحدات كل مقرر على أسابيع الفصل', () => {
  for (const c of courses) {
    const meta = cat.get(c.code)!;
    for (const length of SEMESTER_LENGTHS) {
      it(`${c.code} @ ${length} أسبوعاً: كل أسبوع يمتلئ بـ ${meta.cth} ساعة`, () => {
        const hours = { cth: meta.cth!, l: meta.l!, p: meta.p!, t: meta.t ?? 0 };
        const skeleton = buildSemester(hours, length);
        const alloc = allocateUnits(c.units, skeleton, hours);

        expect(alloc).toHaveLength(TEACHING_WEEKS);
        for (const a of alloc) {
          const sum = a.slices.reduce((s, x) => s + x.hours, 0);
          expect(sum, `${c.code} أسبوع ${a.week.numbers[0]}`).toBe(meta.cth);
        }

        const placed = alloc.flatMap((a) => a.slices).reduce((s, x) => s + x.hours, 0);
        expect(placed).toBe(meta.cth! * TEACHING_WEEKS);
      });
    }
  }
});
