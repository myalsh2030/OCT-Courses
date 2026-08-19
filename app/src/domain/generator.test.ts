import { describe, expect, it } from 'vitest';
import { parseCourse, sumPlanHours, type Course } from './course.schema';
import { DEFAULT_DEPARTMENT } from './department';
import { distributeWeeklyGrades, generatableCourses, generateCourse } from './generator';
import { stripEmbeddedFinal } from './planLength';
import { SEMESTER_LENGTHS, type SemesterLength } from './semester';
import { ASSESSMENT_TOOLS, STRATEGY_OPTIONS, WEEK_ORDINALS } from './vocab';

/**
 * المولّد يؤلّف ما لا تنص عليه الخطة، والتأليف مقبول فقط إن كان:
 * صالحاً بمخطط الملف، محافظاً على ثوابت الساعات والدرجات، حتمياً
 * (نفس المدخل ⇒ نفس الملف)، ومقصوراً على مفردات القوائم المضبوطة.
 */

const CODES = generatableCourses();

function gen(code: string, length: SemesterLength = 19): Course {
  return generateCourse(code, { semesterLength: length });
}

describe('توزيع التقييمات الأسبوعية', () => {
  it('يصرف الرصيد كاملاً مهما كان عدد الأسابيع', () => {
    for (const n of [1, 5, 13, 14, 16]) {
      const g = distributeWeeklyGrades(n);
      expect(g).toHaveLength(n);
      expect(g.reduce((s, x) => s + x, 0), `أسابيع ${n}`).toBe(20);
      expect(Math.min(...g)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('المولّد', () => {
  it('يولّد مقررات القسم التخصصية الخمسة عشر', () => {
    expect(CODES).toHaveLength(15);
    expect(CODES.filter((c) => c.startsWith('MMEC'))).toHaveLength(6);
  });

  describe('كل مقرر × كل طول فصل يجتاز مخطط الملف', () => {
    for (const code of CODES) {
      for (const length of SEMESTER_LENGTHS) {
        it(`${code} @ ${length}`, () => {
          const result = parseCourse(gen(code, length));
          expect(result.ok, JSON.stringify(!result.ok && result.issues)).toBe(true);
          if (result.ok) {
            // التحذير الوحيد المسموح: لا مدرب مسند بعد
            expect(result.warnings.map((w) => w.path)).toEqual(['trainers']);
          }
        });
      }
    }
  });

  describe('ثوابت الساعات والدرجات', () => {
    for (const code of CODES) {
      it(`${code}: الساعات = س.أ × ١٦ والدرجات = ١٠٠ في الأطوال الثلاثة`, () => {
        for (const length of SEMESTER_LENGTHS) {
          const c = gen(code, length);
          expect(sumPlanHours(c), `ساعات ${length}`).toBe(c.contactHours * 16);
          const grades = c.plan.reduce(
            (s, w) => s + w.grades.reduce((x, g) => x + (g.value ?? 0), 0),
            0,
          );
          expect(grades, `درجات ${length}`).toBe(100);
        }
      });
    }

    it('مكوّنات المئة: أسبوعية ٢٠ + فترتان ٤٠ + نهائي ٤٠', () => {
      const c = gen('MMIN 141');
      const finals = c.plan.filter((w) => w.units[0].text.startsWith('اختبار نهائي'));
      const finalSum = finals.reduce(
        (s, w) => s + w.grades.reduce((x, g) => x + (g.value ?? 0), 0), 0);
      expect(finalSum).toBe(40);

      const periodSum = c.plan
        .flatMap((w) => w.grades)
        .filter((g) => g.value === 20)
        .reduce((s, g) => s + (g.value ?? 0), 0);
      expect(periodSum).toBe(40);
    });

    it('المقرر المختلط: نهائي عملي ١٣ ونظري ٢٧', () => {
      const c = gen('MMIN 261', 19);
      const practical = c.plan.find((w) => w.units[0].text === 'اختبار نهائي عملي')!;
      const theory = c.plan.find((w) => w.units[0].text === 'اختبار نهائي نظري')!;
      expect(practical.grades[0].value).toBe(13);
      expect(theory.grades[0].value).toBe(27);
      // النظري المدموج يغطي أسبوعين: الثامن عشر والتاسع عشر
      expect(theory.week.map((w) => w.text)).toEqual(['الثامن عشر', 'التاسع عشر']);
    });
  });

  describe('بنية الأسابيع', () => {
    it('كل أسبوع تدريس تجمع ساعات صفوفه س.أ بالضبط', () => {
      for (const code of CODES) {
        const c = gen(code);
        const teaching = c.plan.slice(0, 16);
        for (const [i, w] of teaching.entries()) {
          const sum = w.hours.reduce((s, h) => s + (h.value ?? 0), 0);
          expect(sum, `${code} أسبوع ${i + 1}`).toBe(c.contactHours);
        }
      }
    });

    it('أسماء الأسابيع تغطي ١..طول الفصل بالترتيب', () => {
      for (const length of SEMESTER_LENGTHS) {
        const c = gen('MMIN 141', length);
        const names = c.plan.flatMap((w) => w.week.map((x) => x.text));
        expect(names).toEqual(WEEK_ORDINALS.slice(0, length));
      }
    });

    it('أسبوعا اختبار الفترة يحملان محتوى وحدات إلى جانب صف الاختبار', () => {
      const c = gen('MMIN 141');
      for (const [weekNo, examLabel] of [
        [7, 'اختبار الفترة (١)'],
        [13, 'اختبار الفترة (٢)'],
      ] as const) {
        const w = c.plan[weekNo - 1];
        const last = w.units[w.units.length - 1];
        expect(last.text).toBe(examLabel);
        expect(w.units.length, `أسبوع ${weekNo} يحمل محتوى`).toBeGreaterThan(1);
        // التنسيق المبسّط: خلية واحدة لكل عمود — ساعات الأسبوع كاملة ودرجة ٢٠
        expect(w.hours).toHaveLength(1);
        expect(w.hours[0].value).toBe(c.contactHours);
        expect(w.grades[w.grades.length - 1].value).toBe(20);
        expect(w.tools[w.tools.length - 1].text).toMatch(/^اختبار \( \d \)$/);
      }
    });

    it('الاستراتيجيات والأدوات من المفردات المضبوطة حصراً', () => {
      const strategies = new Set<string>(STRATEGY_OPTIONS);
      const tools = new Set<string>(ASSESSMENT_TOOLS);
      for (const code of CODES) {
        const c = gen(code);
        for (const w of c.plan) {
          for (const s of w.strategies) {
            if (s.text !== '') {
              expect(strategies.has(s.text), `${code}: استراتيجية «${s.text}»`).toBe(true);
            }
          }
          for (const t of w.tools) {
            if (t.text !== '') {
              expect(tools.has(t.text), `${code}: أداة «${t.text}»`).toBe(true);
            }
          }
        }
      }
    });

    it('لا يتكرر موضوع في خطة المقرر أبداً — لا في الأسبوع ولا عبر الأسابيع', () => {
      for (const code of CODES) {
        for (const length of SEMESTER_LENGTHS) {
          const seen = new Set<string>();
          for (const w of gen(code, length).plan) {
            for (const u of w.units) {
              if (u.code === undefined) continue; // صفوف الاختبارات
              expect(seen.has(u.text), `${code}@${length}: «${u.text}» مكرر`).toBe(false);
              seen.add(u.text);
            }
          }
        }
      }
    });

    it('لا شظايا استخراج في المواضيع: لا «الموضوع» ولا أقواس مبتورة', () => {
      for (const code of CODES) {
        for (const w of gen(code).plan) {
          for (const u of w.units) {
            if (u.code === undefined) continue;
            expect(u.text, code).not.toBe('الموضوع');
            expect(u.text.trim().length, `${code}: «${u.text}»`).toBeGreaterThan(5);
            expect(/^[)("»,.]/.test(u.text), `${code}: «${u.text}» يبدأ برمز`).toBe(false);
          }
        }
      }
    });

    it('ترقيم الصفوف بأرقام هندية «٤ ـ ١» لا تعكسها خوارزمية الاتجاه', () => {
      for (const code of CODES) {
        for (const w of gen(code).plan) {
          for (const u of w.units) {
            if (u.code !== undefined) {
              expect(u.code, code).toMatch(/^[٠-٩]+ ـ [٠-٩]+$/);
            }
          }
        }
      }
    });

    it('لكل صف محتوى موضوعٌ غير فارغ وهدفٌ مرقّم', () => {
      for (const code of CODES) {
        const c = gen(code);
        for (const w of c.plan.slice(0, 16)) {
          for (const u of w.units) {
            expect(u.text.trim().length, code).toBeGreaterThan(2);
          }
          expect(w.objectives[0].lines.length).toBeGreaterThanOrEqual(w.units.length - 1);
          for (const line of w.objectives[0].lines) {
            expect(line).toMatch(/^\d+\. /);
          }
        }
      }
    });
  });

  describe('الحتمية وطي الأطوال', () => {
    it('نفس المدخل ينتج نفس الملف حرفياً', () => {
      const a = JSON.stringify(gen('MMIN 253'));
      const b = JSON.stringify(gen('MMIN 253'));
      expect(a).toBe(b);
    });

    it('أسابيع التدريس ١–١٥ متطابقة عبر الأطوال، و١٦ يتغاير بتضمين العملي فقط', () => {
      const plans = SEMESTER_LENGTHS.map((len) => gen('MMIN 141', len).plan);
      const [p17, p18, p19] = plans.map((p) => JSON.stringify(p.slice(0, 15)));
      expect(p17).toBe(p18);
      expect(p18).toBe(p19);
      // أسبوع ١٦ في ١٧ و١٨ = أسبوع ١٦ القانوني + صف الاختبار العملي المضمَّن
      expect(JSON.stringify(plans[0][15])).toBe(JSON.stringify(plans[1][15]));
      expect(JSON.stringify(stripEmbeddedFinal(plans[0][15]))).toBe(
        JSON.stringify(plans[2][15]),
      );
    });

    it('١٧ أسبوعاً: الذيل نظري (٢٧) والعملي مضمَّن في الأسبوع ١٦ (١٣)', () => {
      const c = gen('MMIN 141', 17);
      expect(c.plan).toHaveLength(17);
      const final = c.plan[16];
      expect(final.units[0].text).toBe('اختبار نهائي نظري');
      expect(final.grades[0].value).toBe(27);

      const week16 = c.plan[15];
      expect(week16.units[week16.units.length - 1].text).toBe('اختبار نهائي عملي');
      expect(week16.grades[week16.grades.length - 1].value).toBe(13);
      expect(week16.tools[week16.tools.length - 1].text).toBe('اختبار نهائي');
      // الساعات لم تنقص: خلية الساعات تغطي الصفوف كلها بقيمة س.أ
      expect(week16.hours[0].value).toBe(c.contactHours);
    });

    it('١٨ أسبوعاً: نظري مدموج على أسبوعين والعملي مضمَّن في ١٦', () => {
      const c = gen('MMIN 141', 18);
      expect(c.plan).toHaveLength(17); // ١٦ تدريس + كتلة نظري مدموجة
      const final = c.plan[16];
      expect(final.week.map((w) => w.text)).toEqual(['السابع عشر', 'الثامن عشر']);
      expect(final.units[0].text).toBe('اختبار نهائي نظري');
      expect(final.grades[0].value).toBe(27);
      expect(c.plan[15].grades.at(-1)?.value).toBe(13);
    });
  });

  describe('اشتراطات السلامة خاصة بكل مقرر', () => {
    it('لكل مقرر قائمته الخاصة، ولا تتطابق قائمتان', () => {
      const seen = new Map<string, string>();
      for (const code of CODES) {
        const list = gen(code).safetyInstructions;
        expect(list.length, `${code}: بنود قليلة`).toBeGreaterThanOrEqual(10);
        for (const line of list) {
          expect(line.trim().length, `${code}: بند قصير «${line}»`).toBeGreaterThan(25);
        }
        const key = list.join('|');
        expect(seen.has(key), `${code} يطابق ${seen.get(key)}`).toBe(false);
        seen.set(key, code);
      }
    });

    it('كل مقرر يذكر أخطاره النوعية لا عموميات فقط', () => {
      const mustMention: Record<string, string[]> = {
        'MMIN 171': ['قوس', 'الأكسجين والأستلين', 'الرايش'],
        'MMIN 261': ['الحبس والوسم', 'الدوار'],
        'MMIN 262': ['الهواء المضغوط', 'واقي السمع'],
        'MMIN 221': ['المكثفات', 'حريق كهربائي'],
        'MMIN 253': ['البخار', 'الحبس والوسم'],
        'MMIN 264': ['السرعات الحرجة', 'الحساسات'],
        'MMEC 145': ['الأفران', 'الحمض', 'المنصهر'],
        'MMEC 233': ['الشاشة', 'الظهر'],
        'MMEC 121': ['الضغط المحبوس', 'الأسطوانة'],
        'MMEC 101': ['الملزمة', 'الرايش'],
        'MMIN 141': ['الضغط المحبوس', 'انزلاق'],
        'MMEC 141': ['المدى', 'الحواف الحادة'],
        'MMEC 131': ['الفرجار', 'الظهر'],
        'MMIN 151': ['سخّان المحامل', 'الليزر'],
        'MMIN 252': ['أغطية الحماية', 'انحباس'],
      };
      for (const [code, needles] of Object.entries(mustMention)) {
        const blob = gen(code).safetyInstructions.join(' ');
        for (const needle of needles) {
          expect(blob.includes(needle), `${code} لا يذكر «${needle}»`).toBe(true);
        }
      }
    });

    it('النص العام في القسم يبقى شبكة أمان لمن يُفرغ قائمته', () => {
      expect(DEFAULT_DEPARTMENT.safetyInstructions.length).toBeGreaterThanOrEqual(15);
    });
  });

  it('التجهيزات من ملاحق الخطط لكل المقررات التسعة', () => {
    for (const code of CODES) {
      const c = gen(code);
      expect(c.equipment.length, code).toBeGreaterThanOrEqual(7);
    }
  });

  it('التنسيق المبسّط: خلية واحدة للساعات والاستراتيجية والأداة والدرجة كل أسبوع', () => {
    for (const code of CODES) {
      const c = gen(code);
      for (const w of c.plan) {
        expect(w.hours, code).toHaveLength(1);
        expect(w.strategies, code).toHaveLength(1);
        expect(w.tools, code).toHaveLength(1);
        expect(w.grades, code).toHaveLength(1);
        expect(w.objectives, code).toHaveLength(1);
      }
    }
  });

  it('الأهداف لا تتجاوز ستة في كل قسم — تُدمج أصغر الوحدات المتجاورة', () => {
    for (const code of CODES) {
      const c = gen(code);
      expect(c.objectives.knowledge.length, `${code} معرفية`).toBeLessThanOrEqual(6);
      expect(c.objectives.procedural.length, `${code} إجرائية`).toBeLessThanOrEqual(6);
      expect(c.objectives.knowledge.length).toBe(c.objectives.procedural.length);
      expect(c.objectives.knowledge.length, `${code}: بلا أهداف`).toBeGreaterThan(0);
    }
  });

  it('علم المواد (١١ وحدة) يُدمج إلى ستة أهداف بلا فقدان وحدة', () => {
    const c = gen('MMEC 145');
    expect(c.objectives.knowledge).toHaveLength(6);
    const blob = c.objectives.knowledge.join(' ');
    for (const title of ['اللدائن', 'تآكل المعادن', 'منحنيات التبريد', 'الفحص المجهري']) {
      expect(blob, title).toContain(title);
    }
  });

  it('الساعات المعتمدة عددٌ موجب في كل المقررات — لا رموز', () => {
    for (const code of CODES) {
      const c = gen(code);
      expect(c.creditHours, code).toBeGreaterThan(0);
      expect(JSON.stringify(c)).not.toContain('P2');
    }
    // الورشة التأسيسية: «P2» في خطة الصيانة، والمعتمد ٢ (خطة التصنيع ورايات)
    expect(gen('MMEC 101').creditHours).toBe(2);
  });

  it('المراجع التدريبية المعتمدة في كل المقررات بعناوينها وروابطها', () => {
    for (const code of CODES) {
      const [row, ...rest] = gen(code).references;
      expect(row, code).toBeDefined();
      expect(rest, `${code}: صفوف زائدة`).toHaveLength(0);

      expect(row.main).toBe('الحقيبة التدريبية');
      expect(row.mainUrl).toContain('tvtc.gov.sa');
      expect(row.mainUrl).toContain('packages.aspx');

      expect(row.site).toBe('Blackboard Learn');
      expect(row.siteUrl).toBe('https://lms.elearning.edu.sa/');

      expect(row.platform).toBe('المكتبات الرقمية المفتوحة');
      expect(row.platformUrl).toBe('https://elearning.edu.sa/OLib/');
    }
  });

  it('تعديل مراجع مقرر لا يسري على غيره (نسخة مستقلة لكل ملف)', () => {
    const a = gen('MMIN 141');
    a.references[0].main = 'مرجع خاص';
    expect(gen('MMIN 151').references[0].main).toBe('الحقيبة التدريبية');
  });

  it('يرفض مقرراً بلا مصادر', () => {
    expect(() => gen('MMIN 999' as string)).toThrow(/غير مكتمل المصادر/);
  });
});
