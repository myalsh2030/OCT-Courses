import type * as ExcelJS from 'exceljs';

/**
 * لبنات كتابة ورقة Excel للوثيقة العربية.
 *
 * الورقة شبكة ثابتة من أحد عشر عموداً: هي أقلّ عدد يستوعب جدول الخطة
 * بحقوله الثمانية (مع توسيع عمودَي الموضوع والأهداف)، وينقسم في الوقت
 * نفسه إلى خمس خانات لأيام الساعات المكتبية. كل كتلة في الوثيقة تُرسم
 * بدمج خلايا من هذه الشبكة، فتبقى الأعمدة متسقة بين الصفحات الست.
 */

/** آخر عمود في الشبكة — كل دمج «عرض الصفحة» ينتهي عنده. */
export const LAST_COL = 11;

/** ألوان الوثيقة كما في `src/index.css` — بصيغة ARGB التي يفهمها Excel. */
export const C = {
  bar: 'FF6F6D6B',
  band: 'FFE6E6E6',
  cell: 'FFD4D4D4',
  soft: 'FFEDEDED',
  panel: 'FFF4F4F4',
  white: 'FFFFFFFF',
  ink: 'FF454545',
  blue: 'FF1B5AA6',
  red: 'FFC00000',
  steel: 'FF3C7D91',
  teal: 'FF2AA39A',
  line: 'FFB8B8B8',
} as const;

/**
 * خط عربي متوفر في كل نسخة من Excel. خط الوثيقة المعتمد (Sakkal Majalla)
 * غير مضمون على جهاز المستلم، وغيابه يُسقط النص إلى خط بديل عشوائي —
 * فالمطبوعة تختلف من جهاز لآخر. Arial ثابتٌ يقرأ العربية في كل مكان.
 */
const FONT = 'Arial';

/** ارتفاع صف السطر الواحد بالنقاط، وأساس صفوف الجداول. */
export const LINE = 14;
export const BASE_ROW = 17;

export interface Look {
  bold?: boolean;
  size?: number;
  color?: string;
  fill?: string;
  align?: 'right' | 'center' | 'left';
  wrap?: boolean;
  /** البريد والأرقام والروابط تُقرأ من اليسار حتى لا تنكسر في ورقة RTL. */
  ltr?: boolean;
  /** الحدود مفعّلة افتراضاً؛ تُطفأ في الأشرطة الملوّنة الفاصلة. */
  border?: boolean;
}

/** يقدّر عدد الأسطر بعد الالتفاف — لأن Excel لا يضبط ارتفاع الخلايا المدموجة تلقائياً. */
export function lineCount(text: string, charsPerLine: number): number {
  return text
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

function paint(cell: ExcelJS.Cell, look: Look): void {
  cell.font = {
    name: FONT,
    size: look.size ?? 11,
    bold: look.bold ?? false,
    color: { argb: look.color ?? C.ink },
  };
  cell.alignment = {
    horizontal: look.align ?? 'right',
    vertical: 'middle',
    wrapText: look.wrap ?? false,
    readingOrder: look.ltr ? 'ltr' : 'rtl',
  };
  if (look.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: look.fill } };
  }
  if (look.border !== false) {
    const side = { style: 'thin' as const, color: { argb: C.line } };
    cell.border = { top: side, left: side, bottom: side, right: side };
  }
}

/**
 * قلمٌ يكتب الورقة صفاً بعد صف ويحتفظ بموضعه.
 *
 * الترتيب مقصود: نكتب القيمة والتنسيق في الخلية الرئيسة **ثم** ندمج،
 * لأن exceljs ينسخ تنسيق الخلية الرئيسة إلى بقية خلايا الدمج عند
 * الدمج — والعكس يترك الحدود ناقصة على أطراف الكتلة.
 */
export class SheetWriter {
  readonly sheet: ExcelJS.Worksheet;
  private cursor = 0;

  constructor(sheet: ExcelJS.Worksheet) {
    this.sheet = sheet;
  }

  /** رقم آخر صف فُتح. */
  get lastRow(): number {
    return this.cursor;
  }

  /** يفتح صفاً جديداً بارتفاع محدَّد ويعيد رقمه. */
  open(height: number = BASE_ROW): number {
    this.cursor += 1;
    this.sheet.getRow(this.cursor).height = height;
    return this.cursor;
  }

  /** فراغ فاصل — يقابل `.strip` الرمادي بين كتل الوثيقة. */
  gap(height = 6, fill?: string): void {
    const row = this.open(height);
    if (fill) this.put(row, 1, LAST_COL, '', { fill, border: false });
  }

  /** خلية أفقية: قيمة وتنسيق في `from` ثم دمج حتى `to`. */
  put(row: number, from: number, to: number, value: ExcelJS.CellValue, look: Look = {}): void {
    this.block(row, row, from, to, value, look);
  }

  /** كتلة ممتدة أفقياً ورأسياً — خلايا جدول الخطة ذات الامتداد. */
  block(
    top: number,
    bottom: number,
    from: number,
    to: number,
    value: ExcelJS.CellValue,
    look: Look = {},
  ): void {
    const cell = this.sheet.getCell(top, from);
    cell.value = value;
    paint(cell, look);
    if (bottom > top || to > from) this.sheet.mergeCells(top, from, bottom, to);
  }

  /** شريط عنوان لوحة — يقابل `<h2>` الداكن في الوثيقة. */
  band(title: string): void {
    const row = this.open(24);
    this.put(row, 1, LAST_COL, title, {
      bold: true,
      size: 14,
      color: C.white,
      fill: C.bar,
      align: 'center',
    });
  }

  /** عنوان فرعي داخل لوحة — يقابل `.subhead`. */
  subhead(title: string): void {
    const row = this.open(19);
    this.put(row, 1, LAST_COL, title, {
      bold: true,
      size: 12,
      fill: C.panel,
      align: 'center',
    });
  }

  /** فقرة بعرض الصفحة — يقابل `.textbox`؛ الارتفاع مقدَّر من طول النص. */
  paragraph(value: string, look: Look = {}): void {
    const row = this.open(Math.max(BASE_ROW, lineCount(value, 105) * LINE));
    this.put(row, 1, LAST_COL, value, { size: 11, color: C.blue, wrap: true, ...look });
  }

  /**
   * فاصل صفحة بعد آخر صف مكتوب.
   *
   * exceljs يضع الفاصل **بعد** الصف الذي يُطلب منه، فالنداء يأتي عند
   * نهاية الصفحة لا عند بداية التالية.
   */
  pageBreak(): void {
    this.sheet.getRow(this.cursor).addPageBreak();
  }
}
