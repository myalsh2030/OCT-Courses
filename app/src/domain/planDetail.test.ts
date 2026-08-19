import { describe, expect, it } from 'vitest';
import plan from '../data/department/plan-courses.json';
import detail from '../data/department/plan-detail.json';

/**
 * «المنهج التفصيلي» هو مصدر مواضيع الأسابيع. الاستخراج آلي، والمواءمة مع
 * جدول الوحدات الرسمي تقبل «التجزئة الأخشن»: كتلة تفصيلية واحدة قد تغطي
 * عدة وحدات رسمية متتالية بمجموع ساعاتها (`officialSpan`) — كما في ١٧١
 * حيث يدمج المنهجُ التفصيلي وحدتي القطع (٥+٣٢) في كتلة ٣٧ ساعة.
 */

const official = new Map(plan.courses.map((c) => [c.code, c]));
const courses = detail.courses;

describe('المنهج التفصيلي المستخرج', () => {
  it('يغطي المقررات الخمسة عشر وكلها متحقّقة', () => {
    expect(courses).toHaveLength(15);
    expect(courses.filter((c) => !c.verified).map((c) => c.code)).toEqual([]);
  });

  describe('التجزئة الأخشن تطابق الجدول الرسمي', () => {
    for (const c of courses) {
      it(`${c.code} — الكتل تغطي الوحدات الرسمية كاملةً بلا فجوة ولا تكرار`, () => {
        const off = official.get(c.code)!;
        // الامتدادات متتالية وتغطي كل الوحدات الرسمية بالترتيب
        const covered = c.units.flatMap((u) => u.officialSpan);
        expect(covered).toEqual(off.units.map((_, i) => i));

        for (const u of c.units) {
          const spanSum = u.officialSpan.reduce(
            (s, i) => s + off.units[i].hours, 0);
          expect(u.hours, `${c.code}: كتلة «${u.title}»`).toBe(spanSum);
          if (u.officialSpan.length === 1) {
            expect(u.title).toBe(off.units[u.officialSpan[0]].title);
          }
        }
        const sum = c.units.reduce((s, u) => s + u.hours, 0);
        expect(sum).toBe(c.cth * 16);
      });
    }
  });

  it('١٧١: كتلة القطع المدموجة تغطي الوحدتين ٥+٣٢ = ٣٧', () => {
    const c = courses.find((x) => x.code === 'MMIN 171')!;
    const merged = c.units.find((u) => u.officialSpan.length > 1)!;
    expect(merged.hours).toBe(37);
    expect(merged.officialSpan).toEqual([1, 2]);
  });

  it('كل بند محتوى نص حقيقي لا رمز تعداد', () => {
    for (const c of courses) {
      for (const u of c.units) {
        for (const t of [...u.theory, ...u.practical]) {
          expect(t.trim().length, `${c.code}: بند فارغ`).toBeGreaterThan(1);
          expect(/[؀-ۿA-Za-z]/.test(t), `${c.code}: «${t}»`).toBe(true);
        }
      }
    }
  });

  it('لكل مقرر مواضيع تكفي لبناء أسابيعه', () => {
    for (const c of courses) {
      const topics = c.units.reduce(
        (s: number, u) => s + u.theory.length + u.practical.length, 0);
      expect(topics, `${c.code}: مواضيع قليلة`).toBeGreaterThanOrEqual(c.units.length * 2);
    }
  });

  it('لا تُصدَّر أدوات التقييم من الخطة — النظام يؤلف قائمتها', () => {
    // عمود أدوات التقييم يخرج مشظّى بين سبانات («اء العملي»، «فهية»)، وهو
    // على أي حال قائمة منسدلة يحرّرها المستخدم، فاستخراجه ضرر بلا نفع.
    for (const c of courses) {
      for (const u of c.units) {
        expect(u, `${c.code}`).not.toHaveProperty('tools');
      }
    }
  });

  it('النص العربي سليم — لا آثار رباطات مقلوبة', () => {
    const bad = ['امجل', 'الحمت', 'املقرر', 'امليكان', 'السالمة'];
    for (const c of courses) {
      const blob = c.units
        .flatMap((u) => [u.title, ...u.theory, ...u.practical])
        .join(' ');
      for (const b of bad) expect(blob.includes(b), `${c.code}: «${b}»`).toBe(false);
    }
  });
});
