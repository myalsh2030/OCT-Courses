import * as ExcelJS from 'exceljs';
import type { Course } from '../domain/course.schema';
import type { ContactBlock, Department, TrainerProfile } from '../domain/department';
import { FORM_TEMPLATE as T } from '../domain/template';
import { planTable } from './planSheet';
import { C, LAST_COL, SheetWriter } from './sheetWriter';

/**
 * تصدير «ملف المدرب وتوصيف المقرر التدريبي» إلى مصنّف Excel.
 *
 * القرار البنيوي بنصّ المالك: «الوثيقة كاملة في **ورقة واحدة** مع
 * **فواصل صفحات** تضمن طباعة كل صفحة على حدة». فالورقة الواحدة تحمل
 * صفحات الوثيقة الست بترتيب `render/CourseDocument.tsx` نفسه، وبينها
 * فواصل صفحات أفقية — لا ست أوراق منفصلة.
 *
 * **عدد الفواصل خمسة لا ستة**: فاصل exceljs يقع *بعد* الصف الذي يُطلب
 * منه، فست صفحات متتابعة يفصل بينها خمسة حدود. فاصلٌ سادس بعد آخر صف
 * كان سيُخرج صفحة سابعة فارغة عند الطباعة.
 *
 * المصنّف يُنتَج في المتصفح على جهاز المدرب: exceljs يوفّر حزمة متصفح
 * جاهزة (`browser` في package.json ⇐ `dist/exceljs.min.js`) فلا خادم في
 * الطريق. الوحدة ثقيلة (~٩٠٠ك.ب) فيُستحسن أن تستوردها الواجهة تحميلاً
 * كسولاً: `await import('../export/workbook')`.
 */

/** عدد أسابيع صفحة الخطة الأولى — كما في `CourseDocument`. */
const PLAN_SPLIT = 10;

/** عرض الأعمدة الأحد عشر بوحدة Excel (تقريباً عدد الحروف). */
const COLUMN_WIDTHS = [8, 6, 13, 13, 13, 7, 17, 17, 12, 10, 7];

/** زوج «مسمى + قيمة» مرتين في الصف — يقابل `.fields` ذا العمودين. */
const FIELD = { labelA: [1, 2], valueA: [3, 5], labelB: [6, 7], valueB: [8, 11] } as const;

/** شبكة الثلاثة أعمدة: المراجع، وتقييم الجودة. */
const THIRDS = [
  [1, 4],
  [5, 8],
  [9, 11],
] as const;

/** خمس خانات على أحد عشر عموداً: أيام الساعات المكتبية، وروابط مهمة. */
const FIFTHS = [
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 11],
] as const;

/** أقصى طول لاسم ورقة في Excel. */
const SHEET_NAME_LIMIT = 31;

/* ═════════════════════ الواجهة العامة ═════════════════════ */

/** مصنّف لمقرر واحد: ورقة واحدة تحمل الصفحات الست. */
export function buildWorkbook(
  course: Course,
  department: Department,
  trainer: TrainerProfile,
  signedAt: string,
  planSplit: number = PLAN_SPLIT,
): ExcelJS.Workbook {
  return buildWorkbookAll([course], department, trainer, signedAt, planSplit);
}

/**
 * مصنّف لعدة مقررات: ورقة لكل مقرر — زر «تنزيل Excel» للمدرب الذي
 * يدرّس أكثر من مقرر يُنزّل ملفاً واحداً فيه خططه كلها.
 */
export function buildWorkbookAll(
  courses: Course[],
  department: Department,
  trainer: TrainerProfile,
  signedAt: string,
  planSplit: number = PLAN_SPLIT,
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = T.documentTitle.title;
  workbook.created = new Date();

  const taken = new Set<string>();
  for (const course of courses) {
    const name = sheetName(course, taken);
    taken.add(name.toLowerCase());
    writeCourseSheet(workbook, name, course, department, trainer, signedAt, planSplit);
  }
  return workbook;
}

/**
 * اسم الورقة = رمز المقرر بالعربية («مصيم-141») ضمن حدود Excel:
 * ٣١ حرفاً، وبلا `: \ / ? * [ ]`، ولا يبدأ أو ينتهي بفاصلة عليا، ولا
 * يتكرر داخل المصنّف — والتكرار يرفضه exceljs باستثناء.
 */
export function sheetName(course: Course, taken: Set<string> = new Set()): string {
  const cleaned = course.rayatCode
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/^'+|'+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const base = (cleaned || course.id).slice(0, SHEET_NAME_LIMIT);
  if (!taken.has(base.toLowerCase())) return base;

  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, SHEET_NAME_LIMIT - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * أرقام الصفوف التي بعدها فواصل الصفحات — للتحقق وللواجهة.
 * exceljs يحمل `rowBreaks` في نموذج الورقة لا في واجهتها المباشرة.
 */
export function pageBreakRows(sheet: ExcelJS.Worksheet): number[] {
  return sheet.model.rowBreaks.map((brk) => brk.id);
}

/* ═════════════════════ بناء الورقة ═════════════════════ */

function writeCourseSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  course: Course,
  department: Department,
  trainer: TrainerProfile,
  signedAt: string,
  planSplit: number,
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, {
    // الوثيقة عربية: العمود الأول على اليمين والتمرير من اليمين.
    views: [{ rightToLeft: true }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      // عرض صفحة واحدة، وأما الطول فيتركه صفرٌ للفواصل اليدوية أدناه:
      // لو قُيّد الطول بصفحة لانضغطت الوثيقة كلها في ورقة واحدة.
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0.15, footer: 0.15 },
    },
  });
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const w = new SheetWriter(sheet);
  const safety =
    course.safetyInstructions.length > 0 ? course.safetyInstructions : department.safetyInstructions;

  // ═══ الصفحات الست بترتيب الوثيقة؛ فاصلٌ بعد كل صفحة إلا الأخيرة ═══
  pageTrainer(w, department, trainer);
  w.pageBreak();

  pageCourse(w, course, department);
  w.pageBreak();

  pageRequirements(w, course, department, safety);
  w.pageBreak();

  pagePlanFirst(w, course, department, planSplit);
  w.pageBreak();

  pagePlanRest(w, course, department, planSplit);
  w.pageBreak();

  pageClosing(w, course, department, trainer, signedAt);

  return sheet;
}

/** ترويسة الوثيقة — تتكرر في صدر كل صفحة كما في `DocHeader`. */
function docHeader(w: SheetWriter, college: string): void {
  const look = { fill: C.panel, align: 'center' as const, bold: true };
  const r1 = w.open(20);
  w.put(r1, 1, 5, T.organization.ar, { ...look, size: 13 });
  w.put(r1, 6, LAST_COL, T.documentTitle.authority, { ...look, size: 12 });

  const r2 = w.open(16);
  w.put(r2, 1, 5, T.organization.en, { ...look, bold: false, size: 9, ltr: true });
  w.put(r2, 6, LAST_COL, T.documentTitle.title, { ...look, size: 14 });

  const r3 = w.open(18);
  w.put(r3, 1, 5, college, { ...look, size: 12 });
  w.put(r3, 6, LAST_COL, '', { ...look });
}

interface FieldCell {
  label: string;
  value: string;
  /** القيم اللاتينية (أرقام، بريد) تُقرأ من اليسار. */
  ltr?: boolean;
}

function fieldRow(w: SheetWriter, a: FieldCell, b: FieldCell): void {
  const row = w.open(20);
  const label = { fill: C.band, align: 'center' as const, wrap: true, size: 10 };
  const value = { color: C.blue, align: 'center' as const, size: 11 };
  w.put(row, FIELD.labelA[0], FIELD.labelA[1], a.label, label);
  w.put(row, FIELD.valueA[0], FIELD.valueA[1], a.value, { ...value, ltr: a.ltr });
  w.put(row, FIELD.labelB[0], FIELD.labelB[1], b.label, label);
  w.put(row, FIELD.valueB[0], FIELD.valueB[1], b.value, { ...value, ltr: b.ltr });
}

/* ───────────── ١ — بيانات المدرب ووسيلة التواصل ───────────── */

function pageTrainer(w: SheetWriter, department: Department, trainer: TrainerProfile): void {
  docHeader(w, department.college);

  w.band(T.panels.trainer);
  fieldRow(
    w,
    { label: 'رقم المدرب', value: trainer.trainerNo, ltr: true },
    { label: 'اسم/رقم المبنى', value: trainer.building, ltr: true },
  );
  fieldRow(
    w,
    { label: 'اسم المدرب', value: trainer.name },
    { label: 'اسم/رقم المكتب', value: trainer.office, ltr: true },
  );
  fieldRow(
    w,
    { label: 'القسم التدريبي', value: department.department },
    { label: 'البريد الالكتروني', value: trainer.email, ltr: true },
  );

  w.band(T.panels.contact);
  w.gap(6, C.band); // الأشرطة الرمادية الفاصلة بين كتل التواصل — `.strip`
  contactBlock(w, trainer, T.contactChannels.withCourseTrainer, 'whatsapp', false);
  w.gap(6, C.band);
  contactBlock(w, department.headOfDepartment, T.contactChannels.withHeadOfDepartment, 'other', true);
  w.gap(6, C.band);
  w.paragraph(`${T.contactNotice} ( ${T.traineeEmailPattern} ).`, {
    color: C.ink,
    align: 'center',
    fill: C.soft,
  });
}

/** مربع تأشير النموذج نصاً — Excel لا يحمل مربعات تأشير داخل الخلايا. */
function mark(checked: boolean): string {
  return checked ? '[✓]' : '[ ]';
}

/**
 * كتلة «آلية التواصل»: صف الوسائل، ثم شريط الساعات المكتبية، ثم
 * الأيام الخمسة وأوقات كل يوم. واتساب قناة اختيارية لا تظهر بلا رقم.
 */
function contactBlock(
  w: SheetWriter,
  contact: ContactBlock,
  side: readonly string[],
  thirdChannel: 'whatsapp' | 'other',
  showOffice: boolean,
): void {
  const { channels } = contact;
  const head = w.open(18);
  w.put(head, 1, LAST_COL, side.join(' '), {
    bold: true,
    fill: C.soft,
    align: 'center',
    size: 12,
  });

  const ways = w.open(18);
  w.put(ways, 1, 4, `${mark(channels.email)} ${T.contactChannels.email} : ( ${contact.email} )`, {
    size: 10,
  });
  w.put(ways, 5, 7, `${mark(channels.officeHours)} ${T.contactChannels.officeHours}`, { size: 10 });
  const hasWhatsapp = contact.whatsapp.trim() !== '';
  const third =
    thirdChannel === 'whatsapp'
      ? hasWhatsapp
        ? `${mark(channels.whatsapp)} ${T.contactChannels.whatsapp} : ( ${contact.whatsapp} )`
        : ''
      : `${mark(channels.other)} ${T.contactChannels.other} : ( ${channels.otherValue} )`;
  w.put(ways, 8, LAST_COL, third, { size: 10 });

  const bar = w.open(17);
  const office = showOffice ? ` — ${T.contactChannels.office} : ( ${contact.office} )` : '';
  w.put(bar, 1, LAST_COL, `${T.contactChannels.officeHoursBar}${office}`, {
    fill: C.band,
    align: 'center',
    size: 10,
  });

  const days = w.open(17);
  const labels = w.open(15);
  const times = w.open(17);
  contact.officeHours.forEach((hours, i) => {
    const [from, to] = FIFTHS[i];
    w.put(days, from, to, hours.day, { fill: C.cell, align: 'center', size: 10 });
    w.put(labels, from, from, T.contactChannels.from, { align: 'center', size: 9 });
    w.put(labels, from + 1, to, T.contactChannels.to, { align: 'center', size: 9 });
    w.put(times, from, from, hours.from, { align: 'center', size: 10, color: C.blue, ltr: true });
    w.put(times, from + 1, to, hours.to, { align: 'center', size: 10, color: C.blue, ltr: true });
  });
}

/* ───────────── ٢ — بيانات المقرر والأهداف ───────────── */

function pageCourse(w: SheetWriter, course: Course, department: Department): void {
  docHeader(w, department.college);
  w.band(T.panels.course);

  fieldRow(
    w,
    { label: 'القسم التدريبي', value: department.department },
    { label: 'ساعات الاتصال', value: String(course.contactHours), ltr: true },
  );
  fieldRow(
    w,
    { label: 'التخصص', value: department.specialization },
    { label: 'الساعات المعتمدة', value: String(course.creditHours), ltr: true },
  );
  fieldRow(
    w,
    { label: 'رمز المقرر', value: course.displayCode },
    { label: 'نمط التدريب', value: course.trainingMode },
  );
  fieldRow(
    w,
    { label: 'اسم المقرر', value: course.name },
    { label: 'مستوى المقرر', value: String(course.level), ltr: true },
  );
  fieldRow(
    w,
    { label: 'نوع التدريب', value: course.trainingType },
    { label: 'المتطلب السابق', value: course.prerequisite },
  );

  w.subhead(T.panels.description);
  w.paragraph(course.description);

  w.subhead(T.panels.generalObjective);
  w.paragraph(course.generalObjective);

  w.subhead(T.panels.detailedObjectives);
  listBlock(w, 'أولاً: الأهداف المعرفية:', course.objectives.knowledge, (line, i) => `${i + 1}. ${line}`);
  listBlock(w, 'ثانياً: الأهداف الإجرائية:', course.objectives.procedural, (line, i) => `${i + 1}. ${line}`);
}

/** عنوان بند + «أن يكون المتدرب قادراً على:» + سطر لكل هدف. */
function listBlock(
  w: SheetWriter,
  title: string,
  lines: string[],
  format: (line: string, index: number) => string,
): void {
  w.paragraph(title, { color: C.ink, bold: true });
  w.paragraph('أن يكون المتدرب قادراً على:', { color: C.ink });
  lines.forEach((line, i) => w.paragraph(format(line, i)));
}

/* ───────────── ٣ — متطلبات التدريب ───────────── */

function pageRequirements(
  w: SheetWriter,
  course: Course,
  department: Department,
  safety: string[],
): void {
  docHeader(w, department.college);
  w.band(T.panels.requirements);

  w.subhead(T.panels.equipment);
  w.paragraph(`الموارد: ${course.resources}`);
  w.paragraph(`${T.panels.equipment}:`, { color: C.ink, bold: true });
  course.equipment.forEach((item, i) => w.paragraph(`${i + 1}) ${item}`));

  w.subhead(T.panels.safety);
  safety.forEach((line) => w.paragraph(line));
}

/* ───────────── ٤ و ٥ — الخطة التدريبية ───────────── */

function pagePlanFirst(
  w: SheetWriter,
  course: Course,
  department: Department,
  planSplit: number,
): void {
  docHeader(w, department.college);
  w.band(T.panels.plan);
  planTable(w, course.plan.slice(0, planSplit));
}

function pagePlanRest(
  w: SheetWriter,
  course: Course,
  department: Department,
  planSplit: number,
): void {
  docHeader(w, department.college);
  w.band(T.panels.plan);
  planTable(w, course.plan.slice(planSplit));

  // المجاميع المعلنة
  totalRow(w, `مجموع درجات التقييمات من ( ${course.declaredTotalGrades} ) درجة`, course.declaredTotalGrades);
  totalRow(w, `مجموع ساعات التدريب الفصلية من ( ${course.declaredTotalHours} ) ساعة`, course.declaredTotalHours);

  // تنويه طرق ووسائل التدريب — نصه كما في النموذج، ورابطه في الخلية.
  const notice = w.open(20);
  w.put(notice, 1, LAST_COL, { text: T.trainingMethodsNotice, hyperlink: T.trainingMethodsUrl }, {
    color: C.red,
    bold: true,
    align: 'center',
    size: 10,
    fill: C.band,
  });

  // صناديق الدرجات الثلاثة: عنوان فوق قيمة
  const scale = department.gradeScale;
  const boxes: [string, number][] = [
    [`درجة الأعمال الفصلية من ( ${scale.coursework} ) درجة`, scale.coursework],
    [`درجة الاختبار النهائي من ( ${scale.finalExam} ) درجة`, scale.finalExam],
    [`مجموع الدرجات من ( ${scale.total} ) درجة`, scale.total],
  ];
  const caption = w.open(20);
  const value = w.open(18);
  boxes.forEach(([text, number], i) => {
    const [from, to] = THIRDS[i];
    w.put(caption, from, to, text, { fill: C.band, align: 'center', wrap: true, size: 10 });
    w.put(value, from, to, number, { align: 'center', color: C.blue, size: 11, ltr: true });
  });
}

function totalRow(w: SheetWriter, text: string, value: number): void {
  const row = w.open(19);
  w.put(row, 1, 9, text, { fill: C.band, align: 'center', size: 11 });
  w.put(row, 10, LAST_COL, value, { align: 'center', color: C.blue, size: 11, ltr: true });
}

/* ───────────── ٦ — المراجع والتقييم والتوقيع ───────────── */

function pageClosing(
  w: SheetWriter,
  course: Course,
  department: Department,
  trainer: TrainerProfile,
  signedAt: string,
): void {
  docHeader(w, department.college);

  w.band(T.panels.references);
  gridRow(w, [T.referenceColumns.main, T.referenceColumns.sites, T.referenceColumns.platforms], true);
  for (const row of course.references) {
    const cells = [
      linked(row.main, row.mainUrl),
      linked(row.site, row.siteUrl),
      linked(row.platform, row.platformUrl),
    ];
    gridRow(w, cells, false);
  }

  w.band(T.panels.quality);
  const q = T.qualityEvaluation;
  gridRow(w, [q.columns.area, q.columns.evaluators, q.columns.link], true);
  for (const row of q.rows) gridRow(w, [row.area, row.evaluators, row.link], false);

  w.band(T.panels.links);
  const links = w.open(20);
  T.importantLinks.forEach((label, i) => {
    const [from, to] = FIFTHS[i];
    w.put(links, from, to, label, {
      fill: C.steel,
      color: C.white,
      align: 'center',
      wrap: true,
      size: 10,
    });
  });

  signatureRow(w, T.signatureLabels.courseTrainer, trainer.name, trainer.email, signedAt);
  signatureRow(
    w,
    T.signatureLabels.headOfDepartment,
    department.headOfDepartment.name,
    department.headOfDepartment.email,
    signedAt,
  );

  const foot = w.open(20);
  const footLook = { fill: C.teal, color: C.white, align: 'center' as const, size: 10 };
  w.put(foot, THIRDS[0][0], THIRDS[0][1], T.footer.email, { ...footLook, ltr: true });
  w.put(foot, THIRDS[1][0], THIRDS[1][1], `${T.edition} - ${T.editionDate}`, footLook);
  w.put(foot, THIRDS[2][0], THIRDS[2][1], T.footer.authority, footLook);
  w.paragraph(T.footer.note, { color: C.ink, align: 'center', size: 10 });
}

/** نص يحمل رابطه إن وُجد — يقابل خلايا المراجع القابلة للنقر. */
function linked(text: string, url?: string): ExcelJS.CellValue {
  return url ? { text, hyperlink: url } : text;
}

function gridRow(w: SheetWriter, cells: ExcelJS.CellValue[], header: boolean): void {
  const row = w.open(header ? 20 : 22);
  cells.forEach((value, i) => {
    const [from, to] = THIRDS[i];
    w.put(row, from, to, value, {
      fill: header ? C.cell : C.band,
      align: 'center',
      wrap: true,
      size: header ? 11 : 9,
      bold: header,
    });
  });
}

function signatureRow(
  w: SheetWriter,
  label: string,
  name: string,
  email: string,
  date: string,
): void {
  const row = w.open(20);
  const tag = { fill: C.band, align: 'center' as const, wrap: true, size: 10 };
  const value = { align: 'center' as const, color: C.blue, size: 10 };
  w.put(row, 1, 2, label, tag);
  w.put(row, 3, 4, name, value);
  w.put(row, 5, 5, T.signatureLabels.email, tag);
  w.put(row, 6, 8, email, { ...value, ltr: true });
  w.put(row, 9, 9, T.signatureLabels.date, tag);
  w.put(row, 10, LAST_COL, date, { ...value, ltr: true });
}
