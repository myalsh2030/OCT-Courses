import { describe, expect, it } from 'vitest';
import {
  allocateUnits,
  buildSemester,
  PERIOD_EXAM_WEEKS,
  REVIEW_WEEK,
  SEMESTER_LENGTHS,
  TEACHING_WEEKS,
  type CourseHours,
  type PlanUnit,
  type SemesterLength,
} from './semester';
import catalogue from '../data/department/catalogue.json';

/** ميكانيكا الموائع: س.أ ٤ = مح ٢ + عم ٢، والوحدات من ص ١٢ من الخطة. */
const FLUID: CourseHours = { cth: 4, l: 2, p: 2, t: 0 };
const FLUID_UNITS: PlanUnit[] = [
  { title: 'الخواص الفيزيائية للموائع', hours: 11 },
  { title: 'استاتيكا الموائع', hours: 14 },
  { title: 'ديناميكا الموائع', hours: 22 },
  { title: 'التدفق وهبوط الضغط في الأنابيب ومجاري الهواء', hours: 17 },
];

const taught = catalogue.courses.filter((c) => !('coop' in c && c.coop));

describe('هيكل الفصل التدريبي', () => {
  describe('الثابت: Σ الساعات = س.أ × ١٦ مهما طال الفصل', () => {
    for (const length of SEMESTER_LENGTHS) {
      it(`${length} أسبوعاً تعطي ٦٤ ساعة لميكانيكا الموائع`, () => {
        const s = buildSemester(FLUID, length);
        expect(s.totalHours).toBe(64);
        expect(s.totalHours).toBe(s.declaredHours);
      });
    }

    it('يصدق على كل مقررات القسم بأنماط ساعاتها المختلفة', () => {
      for (const c of taught) {
        for (const length of SEMESTER_LENGTHS) {
          const s = buildSemester(
            { cth: c.cth!, l: c.l!, p: c.p!, t: c.t ?? 0 },
            length,
          );
          expect(s.totalHours, `${c.code} @ ${length}`).toBe(c.cth! * TEACHING_WEEKS);
        }
      }
    });
  });

  describe('عدد الأسابيع وترقيمها', () => {
    for (const length of SEMESTER_LENGTHS) {
      it(`${length} أسبوعاً: آخر رقم أسبوع = ${length} بلا فجوات ولا تكرار`, () => {
        const s = buildSemester(FLUID, length);
        const nums = s.weeks.flatMap((w) => w.numbers);
        expect(nums).toEqual(Array.from({ length }, (_, i) => i + 1));
      });
    }

    it('١٦ أسبوعاً فقط تحمل ساعات، والباقي اختبارات نهائية', () => {
      for (const length of SEMESTER_LENGTHS) {
        const s = buildSemester(FLUID, length);
        const bearing = s.weeks.filter((w) => w.theoryHours + w.practicalHours > 0);
        expect(bearing.flatMap((w) => w.numbers)).toHaveLength(TEACHING_WEEKS);
      }
    });
  });

  describe('مواضع اختبارات الفترة والمراجعة', () => {
    it('الفترة الأولى في الأسبوع ٧ والثانية في ١٣ والمراجعة في ١٦', () => {
      const s = buildSemester(FLUID, 19);
      const at = (n: number) => s.weeks.find((w) => w.numbers[0] === n)!;
      expect(at(PERIOD_EXAM_WEEKS[0]).kind).toBe('periodExam');
      expect(at(PERIOD_EXAM_WEEKS[0]).periodIndex).toBe(1);
      expect(at(PERIOD_EXAM_WEEKS[1]).periodIndex).toBe(2);
      expect(at(REVIEW_WEEK).kind).toBe('review');
    });

    it('أسابيع اختبار الفترة والمراجعة تحمل ساعات كباقي الأسابيع', () => {
      const s = buildSemester(FLUID, 19);
      for (const n of [...PERIOD_EXAM_WEEKS, REVIEW_WEEK]) {
        const w = s.weeks.find((x) => x.numbers[0] === n)!;
        expect(w.theoryHours + w.practicalHours).toBe(FLUID.cth);
      }
    });
  });

  describe('أسابيع الاختبار النهائي', () => {
    const finals = (length: SemesterLength, h = FLUID) =>
      buildSemester(h, length).weeks.filter((w) => w.kind.startsWith('final'));

    // قاعدة المالك (٢٠٢٦-٠٧-٢٩): الذيل نظري دائماً، والعملي يدخل أسبوع
    // التدريس الأخير حين لا يتسع الذيل لأسبوع عملي مستقل.
    it('١٧: الذيل نظري والعملي داخل الأسبوع ١٦', () => {
      const f = finals(17);
      expect(f).toHaveLength(1);
      expect(f[0].kind).toBe('finalTheory');
      expect(f[0].numbers).toEqual([17]);
      const week16 = buildSemester(FLUID, 17).weeks[15];
      expect(week16.carriesPracticalFinal).toBe(true);
      expect(week16.theoryHours + week16.practicalHours).toBe(FLUID.cth);
    });

    it('١٨: الأسبوعان الأخيران نظري مدموج والعملي داخل الأسبوع ١٦', () => {
      const f = finals(18);
      expect(f.map((w) => [w.kind, w.numbers])).toEqual([['finalTheory', [17, 18]]]);
      expect(buildSemester(FLUID, 18).weeks[15].carriesPracticalFinal).toBe(true);
    });

    it('١٩: العملي مستقل فلا يُضمَّن في الأسبوع ١٦', () => {
      expect(buildSemester(FLUID, 19).weeks[15].carriesPracticalFinal).toBeUndefined();
    });

    it('أحادي النمط لا يُضمَّن له اختبار في الأسبوع ١٦', () => {
      for (const length of SEMESTER_LENGTHS) {
        const drawing: CourseHours = { cth: 4, l: 0, p: 4 };
        expect(buildSemester(drawing, length).weeks[15].carriesPracticalFinal).toBeUndefined();
      }
    });

    it('١٩: عملي ثم نظري على أسبوعين مدموجين — كوثيقة الموائع', () => {
      const f = finals(19);
      expect(f.map((w) => [w.kind, w.numbers])).toEqual([
        ['finalPractical', [17]],
        ['finalTheory', [18, 19]],
      ]);
    });

    it('المقرر العملي فقط: نهائي عملي واحد يبتلع أسابيع النهائي', () => {
      const drawing: CourseHours = { cth: 4, l: 0, p: 4 }; // الرسم الهندسي ١٣١
      const f = finals(19, drawing);
      expect(f).toHaveLength(1);
      expect(f[0].kind).toBe('finalPractical');
      expect(f[0].numbers).toEqual([17, 18, 19]);
    });

    it('المقرر النظري فقط: نهائي نظري واحد', () => {
      const f = finals(18, { cth: 2, l: 2, p: 0 });
      expect(f).toHaveLength(1);
      expect(f[0].kind).toBe('finalTheory');
      expect(f[0].numbers).toEqual([17, 18]);
    });

    it('أسابيع النهائي بلا ساعات تدريب', () => {
      for (const length of SEMESTER_LENGTHS) {
        for (const w of finals(length)) {
          expect(w.theoryHours + w.practicalHours).toBe(0);
        }
      }
    });
  });

  describe('تقسيم الأسبوع نظري/عملي', () => {
    it('كل أسبوع حامل = مح نظري + عم عملي', () => {
      const s = buildSemester({ cth: 5, l: 1, p: 4 }, 18); // صيانة العناصر ١٥١
      for (const w of s.weeks.filter((x) => x.theoryHours + x.practicalHours > 0)) {
        expect(w.theoryHours).toBe(1);
        expect(w.practicalHours).toBe(4);
      }
    });

    it('المقرر العملي فقط لا ساعة نظرية فيه', () => {
      const s = buildSemester({ cth: 4, l: 0, p: 4 }, 17);
      const bearing = s.weeks.filter((w) => w.practicalHours > 0);
      expect(bearing).toHaveLength(TEACHING_WEEKS);
      expect(bearing.every((w) => w.theoryHours === 0)).toBe(true);
    });
  });

  describe('رفض المدخلات المتناقضة', () => {
    it('مح + عم لا تساوي س.أ', () => {
      expect(() => buildSemester({ cth: 4, l: 2, p: 3 }, 18)).toThrow(/مح \+ عم/);
    });
    it('طول فصل غير مسموح', () => {
      expect(() => buildSemester(FLUID, 20 as SemesterLength)).toThrow(/١٧ أو ١٨ أو ١٩/);
    });
    it('س.أ صفر', () => {
      expect(() => buildSemester({ cth: 0, l: 0, p: 0 }, 18)).toThrow(/س\.أ/);
    });
  });
});

describe('توزيع وحدات الخطة على الأسابيع', () => {
  const skeleton = buildSemester(FLUID, 19);

  it('مجموع ساعات الوحدات الرسمية = ٦٤', () => {
    expect(FLUID_UNITS.reduce((s, u) => s + u.hours, 0)).toBe(64);
  });

  it('كل أسبوع حامل يمتلئ بـ س.أ ساعة بالضبط', () => {
    const alloc = allocateUnits(FLUID_UNITS, skeleton, FLUID);
    expect(alloc).toHaveLength(TEACHING_WEEKS);
    for (const a of alloc) {
      const sum = a.slices.reduce((s, x) => s + x.hours, 0);
      expect(sum, `الأسبوع ${a.week.numbers[0]}`).toBe(FLUID.cth);
    }
  });

  it('لا تُفقد ساعة ولا تُخترع: الموزّع = المعلن', () => {
    const alloc = allocateUnits(FLUID_UNITS, skeleton, FLUID);
    const total = alloc.flatMap((a) => a.slices).reduce((s, x) => s + x.hours, 0);
    expect(total).toBe(64);
  });

  it('كل وحدة تأخذ ساعاتها الرسمية كاملة', () => {
    const alloc = allocateUnits(FLUID_UNITS, skeleton, FLUID);
    const per = new Map<number, number>();
    for (const s of alloc.flatMap((a) => a.slices)) {
      per.set(s.unitIndex, (per.get(s.unitIndex) ?? 0) + s.hours);
    }
    FLUID_UNITS.forEach((u, i) => expect(per.get(i), u.title).toBe(u.hours));
  });

  it('الوحدات تتوالى بالترتيب ولا تتداخل رجوعاً', () => {
    const alloc = allocateUnits(FLUID_UNITS, skeleton, FLUID);
    const seq = alloc.flatMap((a) => a.slices.map((s) => s.unitIndex));
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });

  it('التوزيع لا يتأثر بطول الفصل — الأسابيع الحاملة ١٦ دائماً', () => {
    const shapes = SEMESTER_LENGTHS.map((len) =>
      allocateUnits(FLUID_UNITS, buildSemester(FLUID, len), FLUID).map((a) =>
        a.slices.map((s) => `${s.unitIndex}:${s.hours}`).join(','),
      ),
    );
    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[1]).toEqual(shapes[2]);
  });

  it('يرفض وحدات لا يطابق مجموعها المعلن', () => {
    const bad = [{ title: 'ناقصة', hours: 60 }];
    expect(() => allocateUnits(bad, skeleton, FLUID)).toThrow(/60.*64|64.*60/s);
  });
});
