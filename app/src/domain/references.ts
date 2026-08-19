import type { ReferenceRow } from './course.schema';

/**
 * المراجع التدريبية الافتراضية لكل مقررات القسم (معتمدة من المالك
 * ٢٠٢٦-٠٧-٢٩): مصادر المؤسسة الرسمية الثلاثة، عنوانٌ عربي ظاهر يحمل
 * رابطه. تُولَّد مع كل مقرر ويبقى للمدرب تعديلها أو الإضافة عليها.
 */
export const DEFAULT_REFERENCES: ReferenceRow[] = [
  {
    main: 'الحقيبة التدريبية',
    mainUrl:
      'https://tvtc.gov.sa/ar/Departments/tvtcdepartments/cdd/Pages/packages.aspx?RootFolder=/ar/Departments/tvtcdepartments/cdd/DocLib1/%D8%A7%D9%84%D9%85%D8%B1%D8%A7%D8%AC%D8%B9%20%D8%A7%D9%84%D8%B1%D9%82%D9%85%D9%8A%D8%A9#dflip-df_manual_custom215/1/',
    site: 'Blackboard Learn',
    siteUrl: 'https://lms.elearning.edu.sa/',
    platform: 'المكتبات الرقمية المفتوحة',
    platformUrl: 'https://elearning.edu.sa/OLib/',
  },
];
