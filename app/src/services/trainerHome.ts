import type { TrainerSection } from '../domain/bundle';
import type { Course, ReferenceRow } from '../domain/course.schema';
import type { TrainerProfile } from '../domain/department';
import { findMissing, type CourseCheck, type MissingItem } from '../domain/missing';
import { getCourseService } from './courseService';
import type { TrainerSession } from './session';

/**
 * تجميع ما تعرضه لوحة المدرب في بنيةٍ واحدة: مقرراته المسندة من سجله
 * المفكوك، موصولةً بتوصيفاتها في بيانات التطبيق، مع نواقص ملفه.
 *
 * فُصلت عن المكوّن لأنها منطق لا عرض: المقرر المسند بلا توصيف، والمقرر
 * الموصَّف بمسودّة، وحساب النواقص — كلها قرارات تُقرأ هنا مرة واحدة.
 */

export interface AssignedCourse extends CourseCheck {
  /** رمز رايات العربي هو المعروض: «مصيم-141» لا «MMIN 141». */
  rayatCode: string;
  /** فارغ للمقرر المسند بلا توصيف تفصيلي. */
  courseId: string;
  displayCode: string;
  level: number;
  contactHours: number;
  trainingType: string;
  hasDraft: boolean;
  /** شعبه في هذا الفصل بأرقامها المرجعية. */
  sections: TrainerSection[];
  /** الوثيقة المعروضة (المسودّة إن وُجدت) — لتصدير Excel والطباعة. */
  course: Course | null;
}

export interface HomeData {
  profile: TrainerProfile;
  courses: AssignedCourse[];
  missing: MissingItem[];
}

const NO_REFERENCES: ReferenceRow[] = [];

/** يجمع شعب المدرب تحت رموز مقرراتها بترتيب ورودها في السجل. */
function sectionsByCode(sections: TrainerSection[]): Map<string, TrainerSection[]> {
  const map = new Map<string, TrainerSection[]>();
  for (const section of sections) {
    const list = map.get(section.rayatCode);
    if (list) list.push(section);
    else map.set(section.rayatCode, [section]);
  }
  return map;
}

/**
 * يقرأ لوحة المدرب كاملة. الترتيب: المقررات الموصَّفة بمستوياتها كما
 * ترتّبها الخدمة، ثم المسندة بلا توصيف في آخر الشبكة — فهي حالةٌ تُعالَج
 * لا عملٌ يومي.
 */
export async function loadHomeData(session: TrainerSession): Promise<HomeData> {
  const service = await getCourseService();
  const [items, profile] = await Promise.all([
    service.list(session.trainerNo),
    service.getTrainer(),
  ]);

  const bySection = sectionsByCode(session.record.sections);
  const courses: AssignedCourse[] = [];

  for (const item of items) {
    const view = await service.view(item.id);
    courses.push({
      courseId: item.id,
      rayatCode: item.rayatCode,
      displayCode: item.displayCode,
      name: item.name,
      level: item.level,
      contactHours: item.contactHours,
      trainingType: item.trainingType,
      hasDocument: true,
      hasDraft: item.hasDraft,
      references: view?.effective.references ?? NO_REFERENCES,
      sections: bySection.get(item.rayatCode) ?? [],
      course: view?.effective ?? null,
    });
  }

  const described = new Set(items.map((i) => i.rayatCode));
  for (const [rayatCode, sections] of bySection) {
    if (described.has(rayatCode)) continue;
    courses.push({
      courseId: '',
      rayatCode,
      displayCode: rayatCode,
      name: sections[0]?.courseName ?? rayatCode,
      level: 0,
      contactHours: 0,
      trainingType: '',
      hasDocument: false,
      hasDraft: false,
      references: NO_REFERENCES,
      sections,
      course: null,
    });
  }

  return { profile, courses, missing: findMissing(profile, courses) };
}
