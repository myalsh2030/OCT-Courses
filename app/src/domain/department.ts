import { z } from 'zod';

/**
 * ثوابت القسم — تُعرَّف مرة واحدة ويرثها كل مقرر.
 * وضعها هنا يمنع تكرار ١٨ تعليمة سلامة في خمسة عشر ملف مقرر،
 * ويجعل تعديلها لاحقاً في موضع واحد.
 */
/** ساعات يوم واحد؛ الفراغ يعني لا ساعات مكتبية ذلك اليوم. */
export const officeHoursSchema = z.object({
  day: z.string(),
  from: z.string().default(''),
  to: z.string().default(''),
});

export const contactChannelsSchema = z.object({
  email: z.boolean().default(true),
  officeHours: z.boolean().default(true),
  whatsapp: z.boolean().default(false),
  other: z.boolean().default(false),
  otherValue: z.string().default(''),
});

/** كتلة «آلية التواصل» — يشترك فيها مدرب المقرر ورئيس القسم. */
export const contactBlockSchema = z.object({
  name: z.string(),
  email: z.string().default(''),
  whatsapp: z.string().default(''),
  /** رقم المكتب الذي تُقضى فيه الساعات المكتبية (يظهر في كتلة رئيس القسم). */
  office: z.string().default(''),
  channels: contactChannelsSchema,
  officeHours: z.array(officeHoursSchema).length(5, 'خمسة أيام: الأحد … الخميس'),
});

export const departmentSchema = z.object({
  id: z.string(),
  college: z.string(),
  department: z.string(),
  specialization: z.string(),
  headOfDepartment: contactBlockSchema,
  safetyInstructions: z.array(z.string()),
  gradeScale: z.object({
    coursework: z.number().int().positive(),
    finalExam: z.number().int().positive(),
    total: z.number().int().positive(),
  }),
});

export type Department = z.infer<typeof departmentSchema>;

export const DEFAULT_DEPARTMENT: Department = {
  id: 'mech-unaizah',
  college: 'الكلية التقنية بعنيزة',
  department: 'التقنية الميكانيكية',
  specialization: 'تقنية الصيانة الميكانيكية',
  headOfDepartment: {
    // البيانات المعتمدة من المالك (٢٠٢٦-٠٧-٢٩)
    name: 'م. محمد ابراهيم عبدالله الحمدا',
    email: 'm.alhamda@tvtc.gov.sa',
    whatsapp: '',
    office: '1350610108',
    channels: { email: true, officeHours: true, whatsapp: false, other: false, otherValue: '' },
    officeHours: [
      { day: 'الأحد', from: '08 : 00', to: '10 : 00' },
      { day: 'الأثنين', from: '', to: '' },
      { day: 'الثلاثاء', from: '08 : 00', to: '10 : 00' },
      { day: 'الاربعاء', from: '', to: '' },
      { day: 'الخميس', from: '', to: '' },
    ],
  },
  /**
   * نص السلامة العام — شبكة أمان فقط. كل مقرر يحمل اشتراطاته الخاصة
   * (domain/safety.ts) منذ ٢٠٢٦-٠٨-٠٢، ولا يظهر هذا النص إلا إذا أفرغ
   * المدرب قائمة مقرره عمداً.
   */
  safetyInstructions: [
    'اتبع الإرشادات والتوجيهات لأجل سلامتك وسلامة الآخرين.',
    'تجنب تشغيل الأجهزة والمعدات إلا بعد التدريب وإذن المدرب.',
    'استخدم المعدات الواقية المخصصة للعمل المحدد.',
    'تجنب الالتفات إلى الأشياء التي تشتت الانتباه أثناء العمل.',
    'تأكد من إلمامك بالمعلومات والإرشادات حول مواضيع السلامة والتدريب المتعلقة بالعمل الذي ستقوم به.',
    'تأكد من وجود مساحة كافية للعمل.',
    'تأكد من معرفتك لأماكن وجود مخارج الطوارئ والسبل الآمنة للخروج.',
    'افحص سلامة المعدات والأدوات قبل تشغيلها للتأكد من سلامتها وضمان عملها بشكل سليم.',
    'تجنب إجراء أي تعديلات على المعدات أو الأدوات دون موافقة مدرب المقرر.',
    'قم بالإبلاغ عن أي خلل أو مخاطر تتعلق بالعمل بشكل فوري لمدرب المقرر.',
    'تجنب القيام بأي عمل يتعارض مع السلامة الشخصية أو السلامة العامة.',
    'التزم بالقواعد واللوائح الخاصة بالسلامة والصحة المهنية في مكان العمل ولا تتهاون بها.',
    'حافظ على نظافة وترتيب مكان العمل وتجنب الفوضى والازدحام.',
    'تجنب استخدام المعدات والأدوات بطريقة خاطئة أو غير مخصصة للعمل المحدد.',
    'تجنب إجراء أي تجارب أو تجارب عملية دون موافقة المشرف على العمل.',
    'الحفاظ على السلامة الشخصية بشكل عام، وذلك عن طريق ارتداء الملابس الواقية المناسبة وعدم التعرض لأي مواد خطرة.',
    'تجنب التدخين أو استخدام الأجهزة الإلكترونية في مكان العمل، حيث يمكن أن يؤدي ذلك إلى وقوع حوادث.',
    'اتبع الإرشادات للتخلص من المخلفات والنفايات بشكل صحيح وآمن.',
  ],
  gradeScale: { coursework: 60, finalExam: 40, total: 100 },
};

/**
 * بيانات المدرب التي لا يوفّرها تقرير رايات — يُدخلها المدرب بنفسه.
 * منفصلة عن ملف المقرر لأن المقرر قد يشترك فيه أكثر من مدرب،
 * فتُحقن هذه الكتلة وقت الطباعة حسب المدرب المختار.
 */
export const trainerProfileSchema = contactBlockSchema.extend({
  id: z.string(),
  trainerNo: z.string().regex(/^\d{7}$/, 'رقم المدرب سبعة أرقام'),
  /** الاسم كما يريده المدرب في الوثيقة، مع اللقب: «م/ محمد يوسف الشبيلي». */
  name: z.string().min(1),
  building: z.string().default(''),
  updatedAt: z.string().default(''),
});

/**
 * رقم المبنى من رقم المكتب: الخانتان الرابعة والخامسة من اليسار
 * (١٣٥«٠٦»١٠١٠٨ ⇐ «06») — قاعدة ترقيم الكلية التي أقرّها المالك
 * (٢٠٢٦-٠٨-٠٢)، فلا يُدخل المبنى يدوياً ولا يتناقض مع المكتب.
 */
export function buildingFromOffice(office: string): string {
  const digits = office.replace(/\D/g, '');
  return digits.length >= 5 ? digits.slice(3, 5) : '';
}

export type TrainerProfile = z.infer<typeof trainerProfileSchema>;
export type ContactBlock = z.infer<typeof contactBlockSchema>;
export type OfficeHours = z.infer<typeof officeHoursSchema>;
export type ContactChannels = z.infer<typeof contactChannelsSchema>;
