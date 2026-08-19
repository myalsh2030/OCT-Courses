import type { CollectionSchema } from './types';

export const DB_NAME = 'tvtc-course-files';

/**
 * رقم إصدار المخزن. يُزاد عند إضافة مجموعة أو فهرس جديد،
 * فيتولّى `onupgradeneeded` إنشاء الناقص دون فقد البيانات القائمة.
 */
export const DB_VERSION = 4;

export const COLLECTIONS = {
  /** النسخة الأصلية لكل مقرر (المرجع الذي لا يُعدَّل). */
  courses: { indexes: ['rayatCode', 'level'] },
  /** إصدارات معدّلة لمقرر: الأصلية + كل تعديل مُصدَّر ومرفوع. */
  versions: { indexes: ['courseId', 'createdAt'] },
  /** بيانات المدرب التي يُدخلها بنفسه (إيميل، مكتب، ساعات مكتبية). */
  trainerProfiles: { indexes: ['trainerNo'] },
  /** مسودّات التحرير المحلية قبل التصدير. */
  drafts: { indexes: ['courseId'] },
  /** روابط مقرر ↔ مدرب المستوردة من تقرير رايات SS01 (تُستبدل عند كل رفع). */
  assignments: { indexes: ['courseId', 'trainerNo'] },
  /** إعدادات عامة (القسم، التخصص، رئيس القسم، هوية المعدِّل). */
  settings: { indexes: [] },
  /**
   * لقطات تقرير الشعب (SS01) التي رفعها الأدمن — لقطة واحدة لكل فصل
   * على جهازه، تُقارَن بها الرفعة التالية وتُبنى منها حزمة الفصل.
   * لا تُنشر ولا تغادر الجهاز؛ صفحة الأدمن وحدها تكتب فيها وتقرأ منها.
   */
  ss01Terms: { indexes: ['savedAt'] },
} as const satisfies Record<string, CollectionSchema>;

export type CollectionName = keyof typeof COLLECTIONS;

export const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];
