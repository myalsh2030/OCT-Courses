import type * as ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import courseJson from '../test/fixtures/MMIN-141.reference.json';
import trainerJson from '../data/trainers/0013270.json';
import { parseCourse, type Course } from '../domain/course.schema';
import { DEFAULT_DEPARTMENT, trainerProfileSchema } from '../domain/department';
import { FORM_TEMPLATE as T } from '../domain/template';
import { buildWorkbook, buildWorkbookAll, pageBreakRows, sheetName } from './workbook';

/**
 * حارس تصدير Excel.
 *
 * المطلوب بنصّ المالك: «الوثيقة كاملة في ورقة واحدة مع فواصل صفحات
 * تضمن طباعة كل صفحة على حدة». فالمقياس هنا ثلاثة:
 * ١) ورقة واحدة لكل مقرر تحمل الصفحات الست بالترتيب،
 * ٢) فواصل صفحات عند حدودها بالضبط،
 * ٣) إعداد ورقة عربية A4 يجعل كل مقطع يُطبع في صفحة واحدة.
 */

const SIGNED_AT = '2026/01/31';

function reference(): Course {
  const parsed = parseCourse(courseJson);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
  return parsed.course;
}

const TRAINER = trainerProfileSchema.parse(trainerJson);

function sheetOf(course = reference()): ExcelJS.Worksheet {
  const workbook = buildWorkbook(course, DEFAULT_DEPARTMENT, TRAINER, SIGNED_AT);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('لا ورقة في المصنّف');
  return sheet;
}

/** نصوص كل الخلايا — الروابط تُقرأ بنصها الظاهر لا بعنوانها. */
function cellTexts(sheet: ExcelJS.Worksheet): string[] {
  const texts: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell({ includeEmpty: false }, (cell) => texts.push(readCell(cell.value)));
  });
  return texts;
}

function rowText(sheet: ExcelJS.Worksheet, rowNumber: number): string {
  const parts: string[] = [];
  sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => parts.push(readCell(cell.value)));
  return parts.join(' ');
}

function readCell(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) return String(value.text);
  return String(value);
}

/** صف يحمل هذا النص في إحدى خلاياه. */
function hasText(sheet: ExcelJS.Worksheet, needle: string): boolean {
  return cellTexts(sheet).some((text) => text.includes(needle));
}

describe('تصدير المصنّف — ورقة واحدة بفواصل صفحات', () => {
  it('المصنّف لمقرر واحد فيه ورقة واحدة اسمها رمز المقرر بالعربية', () => {
    const course = reference();
    const workbook = buildWorkbook(course, DEFAULT_DEPARTMENT, TRAINER, SIGNED_AT);
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0].name).toBe(course.rayatCode);
  });

  /**
   * خمسة فواصل لا ستة — والقرار مقصود:
   * فاصل exceljs يقع **بعد** الصف الذي يُطلب منه، فست صفحات متتابعة
   * يفصل بينها خمسة حدود فقط. الفاصل السادس (بعد آخر صف في الوثيقة)
   * كان سيفتح صفحة سابعة فارغة عند الطباعة، فهو خطأ لا اكتمال.
   */
  it('خمسة فواصل صفحات تفصل الصفحات الست', () => {
    const breaks = pageBreakRows(sheetOf());
    expect(breaks).toHaveLength(5);
    // الفواصل مرتّبة تصاعدياً ولا يتكرر موضع
    expect([...breaks].sort((a, b) => a - b)).toEqual(breaks);
    expect(new Set(breaks).size).toBe(5);
  });

  it('كل فاصل يقع عند حدّ صفحة: الصف التالي له يبدأ بترويسة الوثيقة', () => {
    const sheet = sheetOf();
    const starts = [1, ...pageBreakRows(sheet).map((row) => row + 1)];
    expect(starts).toHaveLength(6);
    for (const start of starts) {
      expect(rowText(sheet, start), `الصف ${start} ليس بداية صفحة`).toContain(T.organization.ar);
    }
  });

  it('الصفحات الست بترتيب الوثيقة: عناوين اللوحات تتوالى كما تُطبع', () => {
    const sheet = sheetOf();
    const texts = cellTexts(sheet);
    const order = [
      T.panels.trainer,
      T.panels.contact,
      T.panels.course,
      T.panels.requirements,
      T.panels.plan,
      T.panels.references,
      T.panels.quality,
      T.panels.links,
    ];
    const positions = order.map((title) => texts.indexOf(title));
    expect(positions.every((p) => p >= 0), `لوحة مفقودة: ${JSON.stringify(positions)}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('إعداد الورقة: عربية RTL وA4 قائمة بعرض صفحة واحدة وطول مفتوح', () => {
    const sheet = sheetOf();
    expect(sheet.views[0].rightToLeft).toBe(true);
    expect(sheet.pageSetup.paperSize).toBe(9); // A4
    expect(sheet.pageSetup.orientation).toBe('portrait');
    expect(sheet.pageSetup.fitToPage).toBe(true);
    expect(sheet.pageSetup.fitToWidth).toBe(1);
    // صفر = لا تقييد للطول: الفواصل اليدوية هي التي تصنع الصفحات الست.
    expect(sheet.pageSetup.fitToHeight).toBe(0);
    const margins = sheet.pageSetup.margins;
    expect(margins && margins.left).toBeLessThanOrEqual(0.4);
  });

  /**
   * fitToWidth=1 يضغط الورقة أفقياً بنسبة تقارب ٩٠٪، فارتفاع صفحة A4
   * المتاح بعد الهوامش ≈ ٨٩٠ نقطة. لو تجاوز مقطعٌ هذا الحد أضاف Excel
   * فاصلاً تلقائياً وصارت الصفحات أكثر من ست — فهذا الحارس يمنع تضخّم
   * الصفوف بصمت عند تغيير التخطيط.
   */
  it('ارتفاع كل صفحة يبقى داخل ورقة A4 فلا ينقسم المقطع تلقائياً', () => {
    const sheet = sheetOf();
    const breaks = pageBreakRows(sheet);
    const bounds = [0, ...breaks, sheet.rowCount];
    for (let page = 0; page < bounds.length - 1; page += 1) {
      let height = 0;
      for (let row = bounds[page] + 1; row <= bounds[page + 1]; row += 1) {
        height += sheet.getRow(row).height ?? 15;
      }
      expect(height, `الصفحة ${page + 1} ارتفاعها ${height} نقطة`).toBeLessThanOrEqual(890);
    }
  });
});

describe('تصدير المصنّف — محتوى الوثيقة', () => {
  it('نصوص الوثيقة المحورية موجودة في الخلايا', () => {
    const course = reference();
    const sheet = sheetOf(course);

    expect(hasText(sheet, course.name)).toBe(true);
    expect(hasText(sheet, course.displayCode)).toBe(true);
    expect(hasText(sheet, TRAINER.name)).toBe(true);
    expect(hasText(sheet, TRAINER.email)).toBe(true);
    expect(hasText(sheet, TRAINER.trainerNo)).toBe(true);
    expect(hasText(sheet, DEFAULT_DEPARTMENT.headOfDepartment.name)).toBe(true);
    expect(hasText(sheet, SIGNED_AT)).toBe(true);
    expect(hasText(sheet, T.panels.plan)).toBe(true);
    expect(hasText(sheet, T.documentTitle.title)).toBe(true);
  });

  it('جدول الخطة كامل: عناوين الأعمدة، وأول موضوع، وآخر موضوع', () => {
    const course = reference();
    const sheet = sheetOf(course);
    const c = T.planColumns;

    for (const title of [c.week, c.hours, c.strategy, c.tool, c.grade]) {
      expect(hasText(sheet, title), `عمود مفقود: ${title}`).toBe(true);
    }
    expect(hasText(sheet, c.units)).toBe(true);
    expect(hasText(sheet, c.objectives)).toBe(true);

    const firstTopic = course.plan[0].units[0].text;
    const lastWeek = course.plan[course.plan.length - 1];
    const lastTopic = lastWeek.units[lastWeek.units.length - 1].text;
    expect(hasText(sheet, firstTopic), `أول موضوع مفقود: ${firstTopic}`).toBe(true);
    expect(hasText(sheet, lastTopic), `آخر موضوع مفقود: ${lastTopic}`).toBe(true);

    // موضوع من الصفحة الثانية للخطة (الأسبوع الحادي عشر فصاعداً)
    const laterTopic = course.plan[12].units[0].text;
    expect(hasText(sheet, laterTopic), `موضوع الصفحة الثانية مفقود: ${laterTopic}`).toBe(true);
  });

  it('السلامة والتجهيزات والأهداف والمراجع تظهر كما في الوثيقة', () => {
    const course = reference();
    const sheet = sheetOf(course);
    expect(hasText(sheet, course.generalObjective)).toBe(true);
    expect(hasText(sheet, course.objectives.knowledge[0])).toBe(true);
    expect(hasText(sheet, course.objectives.procedural[0])).toBe(true);
    expect(hasText(sheet, course.equipment[0])).toBe(true);
    // المقرر المرجعي بلا تعليمات خاصة، فيرث تعليمات القسم
    expect(hasText(sheet, DEFAULT_DEPARTMENT.safetyInstructions[0])).toBe(true);
    expect(hasText(sheet, course.references[0].main)).toBe(true);
    expect(hasText(sheet, T.footer.email)).toBe(true);
  });

  it('المجاميع المعلنة وسلّم الدرجات في صفحة الخطة الثانية', () => {
    const course = reference();
    const sheet = sheetOf(course);
    expect(hasText(sheet, `مجموع درجات التقييمات من ( ${course.declaredTotalGrades} ) درجة`)).toBe(true);
    expect(hasText(sheet, `مجموع ساعات التدريب الفصلية من ( ${course.declaredTotalHours} ) ساعة`)).toBe(true);
    expect(hasText(sheet, `درجة الأعمال الفصلية من ( ${DEFAULT_DEPARTMENT.gradeScale.coursework} ) درجة`)).toBe(true);
    expect(hasText(sheet, T.trainingMethodsNotice)).toBe(true);
  });

  it('المصنّف يُكتب ملفاً فعلياً بلا استثناء', async () => {
    const workbook = buildWorkbook(reference(), DEFAULT_DEPARTMENT, TRAINER, SIGNED_AT);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(buffer.byteLength).toBeGreaterThan(5000);
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK'); // ملف ZIP سليم
  });
});

/**
 * الحارس لا يكتفي بالمقرر المرجعي: خطط القسم تتفاوت طولاً (وحدات أكثر،
 * أهداف أطول)، وأيّ خطة تتجاوز ارتفاع الورقة ستُطبع سبع صفحات بدل ست.
 */
const bundledCourses = Object.values(
  import.meta.glob('../data/courses/*.json', { eager: true, import: 'default' }) as Record<
    string,
    unknown
  >,
).map((raw) => {
  const parsed = parseCourse(raw);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
  return parsed.course;
});

describe('تصدير المصنّف — كل مقررات القسم', () => {
  it('مقررات القسم المضمّنة تُقرأ كلها', () => {
    expect(bundledCourses.length).toBeGreaterThanOrEqual(15);
  });

  for (const course of bundledCourses) {
    it(`${course.rayatCode} — ست صفحات، كلٌّ داخل ورقة A4`, () => {
      const workbook = buildWorkbook(course, DEFAULT_DEPARTMENT, TRAINER, SIGNED_AT);
      const sheet = workbook.worksheets[0];
      const breaks = pageBreakRows(sheet);
      expect(breaks).toHaveLength(5);

      const bounds = [0, ...breaks, sheet.rowCount];
      for (let page = 0; page < bounds.length - 1; page += 1) {
        expect(rowText(sheet, bounds[page] + 1)).toContain(T.organization.ar);
        let height = 0;
        for (let row = bounds[page] + 1; row <= bounds[page + 1]; row += 1) {
          height += sheet.getRow(row).height ?? 15;
        }
        expect(height, `الصفحة ${page + 1} ارتفاعها ${height} نقطة`).toBeLessThanOrEqual(890);
      }
    });
  }
});

describe('تصدير المصنّف — عدة مقررات', () => {
  const base = reference();
  const second: Course = { ...base, id: 'MMIN-151', rayatCode: 'مصيم-151', name: 'الرسم الميكانيكي' };
  const third: Course = { ...base, id: 'MMIN-171', rayatCode: 'مصيم-171', name: 'ورشة اللحام' };

  it('ورقة لكل مقرر بأسماء رموزه', () => {
    const workbook = buildWorkbookAll([base, second, third], DEFAULT_DEPARTMENT, TRAINER, SIGNED_AT);
    expect(workbook.worksheets).toHaveLength(3);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'مصيم-141',
      'مصيم-151',
      'مصيم-171',
    ]);
  });

  it('كل ورقة تحمل صفحاتها الست بفواصلها الخمسة واسم مقررها', () => {
    const workbook = buildWorkbookAll([base, second], DEFAULT_DEPARTMENT, TRAINER, SIGNED_AT);
    for (const [index, sheet] of workbook.worksheets.entries()) {
      expect(pageBreakRows(sheet)).toHaveLength(5);
      expect(sheet.views[0].rightToLeft).toBe(true);
      expect(hasText(sheet, [base, second][index].name)).toBe(true);
    }
  });

  it('اسم الورقة يحترم حدود Excel: طولاً ومحارفَ ممنوعة وتكراراً', () => {
    const long: Course = { ...base, rayatCode: 'مصيم/141: تدريب [عملي] * طويل جداً يتجاوز الحد المسموح' };
    const name = sheetName(long);
    expect(name.length).toBeLessThanOrEqual(31);
    expect(/[:\\/?*[\]]/.test(name)).toBe(false);

    const taken = new Set([base.rayatCode.toLowerCase()]);
    const alternative = sheetName(base, taken);
    expect(alternative).not.toBe(base.rayatCode);
    expect(alternative.length).toBeLessThanOrEqual(31);
  });

  it('مقرران برمز واحد لا يتصادمان في المصنّف', () => {
    const twin: Course = { ...base, id: 'MMIN-999' };
    const workbook = buildWorkbookAll([base, twin], DEFAULT_DEPARTMENT, TRAINER, SIGNED_AT);
    expect(workbook.worksheets).toHaveLength(2);
    expect(workbook.worksheets[0].name).not.toBe(workbook.worksheets[1].name);
  });
});
