import { z } from 'zod';

/**
 * صيغة ملف الإصدار المُصدَّر — الوسيط بين جهاز المدرب والصفحة المركزية.
 *
 * المدرب يحرّر محلياً ثم «يصدّر» ملفاً بهذه الصيغة موقّعاً باسمه، ويُرفع
 * الملف للصفحة فيصير إصداراً معتمداً في سجل المقرر. الغلاف يُتحقق منه
 * هنا، ومحتوى المقرر نفسه يُتحقق منه بمخطط المقرر عند الاستيراد.
 */
export const versionFileSchema = z.object({
  kind: z.literal('tvtc-course-version'),
  formatVersion: z.literal(1),
  courseId: z.string().min(1),
  author: z.object({
    trainerNo: z.string().min(1),
    name: z.string().min(1),
  }),
  exportedAt: z.string(),
  note: z.string().default(''),
  /** ملف المقرر الكامل — يُتحقق منه بـ parseCourse لدى الاستيراد. */
  course: z.unknown(),
});

export type VersionFile = z.infer<typeof versionFileSchema>;

/** إصدار محفوظ في سجل المقرر على الصفحة. */
export interface CourseVersionEntity {
  /** `courseId@seq` */
  id: string;
  courseId: string;
  /** تسلسل تصاعدي يبدأ من ١ — الأصل ليس إصداراً بل مرجع دائم. */
  seq: number;
  author: { trainerNo: string; name: string };
  note: string;
  exportedAt: string;
  createdAt: string;
  course: unknown;
}

/** مؤشر الإصدار المعروض افتراضاً لمقرر: الأحدث، أو الأصل، أو تسلسل محدد. */
export type DefaultVersionPointer = 'latest' | 'original' | number;
