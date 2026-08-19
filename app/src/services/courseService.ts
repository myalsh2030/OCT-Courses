import { COLLECTIONS, getStorage, type StorageAdapter } from '../storage';
import { parseCourse, type Course } from '../domain/course.schema';
import {
  buildingFromOffice,
  contactBlockSchema,
  DEFAULT_DEPARTMENT,
  trainerProfileSchema,
  type ContactBlock,
  type TrainerProfile,
} from '../domain/department';
import type { SemesterLength } from '../domain/semester';
import { parseSS01, type SS01Assignment } from '../domain/ss01';
import {
  versionFileSchema,
  type CourseVersionEntity,
  type DefaultVersionPointer,
  type VersionFile,
} from '../domain/versionFile';
import defaultTrainerJson from '../data/trainers/0013270.json';
import knownTrainersJson from '../data/trainers/known-trainers.json';

/**
 * بيانات المدربين المعتمدة من المالك. الغرض منها تعبئة ما لا يوفّره تقرير
 * رايات في القالب: البريد ورقم المكتب (والمبنى مشتق من المكتب). الأسماء
 * المعروضة تبقى كما وردت في التقرير، ولا يُستدعى الاسم الكامل هنا إلا
 * للتفريق حين يتشابه اسمان برقمين وظيفيين مختلفين.
 */
const KNOWN_TRAINERS = knownTrainersJson as Record<
  string,
  { name: string; email: string; office?: string }
>;

/**
 * خدمة المقررات — كل تعامل الواجهة مع البيانات يمرّ من هنا.
 *
 * النموذج: النسخة الأصلية (المولّدة من الخطة) لا تُعدَّل أبداً؛ تحرير
 * المدرب يُحفظ مسودّةً مستقلة تعلو الأصل عند العرض، ويمكن إسقاطها
 * للرجوع إلى الأصل. التصدير والإصدارات المرفوعة تأتي في مرحلة لاحقة
 * فوق نفس هذا الفصل.
 */

/** الأصول المضمّنة مع التطبيق — تُزرع في المخزن عند أول تشغيل. */
const bundledOriginals = import.meta.glob('../data/courses/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

export interface CourseDraft {
  /** معرّف المسودّة = معرّف المقرر (مسودّة واحدة لكل مقرر). */
  id: string;
  courseId: string;
  course: Course;
  updatedAt: string;
}

export interface CourseListItem {
  id: string;
  /** الرمز كما يُطبع في الخطة: «101 منتج» (حروف عربية وأرقام لاتينية). */
  displayCode: string;
  /** رمز رايات: «منتج-101» — يُستعمل في التلميح وربط تقرير SS01. */
  rayatCode: string;
  name: string;
  level: number;
  contactHours: number;
  trainingType: string;
  hasDraft: boolean;
  /** أسماء مدربي المقرر من روابط SS01 (فارغة قبل رفع التقرير). */
  trainers: string[];
  /** عدد الإصدارات المعتمدة المرفوعة. */
  versionCount: number;
}

export interface VersionMeta {
  seq: number;
  author: { trainerNo: string; name: string };
  note: string;
  createdAt: string;
}

export interface CourseView {
  original: Course;
  draft: CourseDraft | null;
  /** الإصدارات المعتمدة مرتّبة تصاعدياً. */
  versions: VersionMeta[];
  /** مؤشر الإصدار المعروض افتراضاً لهذا المقرر. */
  defaultVersion: DefaultVersionPointer;
  /**
   * ما يُعرض فعلاً بترتيب الأولوية: مسودّتي المحلية، ثم الإصدار
   * الافتراضي (الأحدث ما لم يُختر غيره)، ثم الأصل.
   */
  effective: Course;
  /** مصدر النسخة الفعلية — للشارة في الواجهة. */
  effectiveSource: 'draft' | 'version' | 'original';
}

export interface TrainerListItem {
  trainerNo: string;
  name: string;
  courseIds: string[];
}

interface SettingsEntry {
  id: string;
  value: string;
}

const SEMESTER_LENGTH_KEY = 'semesterLength';
const SEED_MARKER_KEY = 'seededAt';
const DEPARTMENT_HEAD_KEY = 'departmentHead';
const ACTIVE_TRAINER_KEY = 'activeTrainer';
const SS01_META_KEY = 'ss01Meta';
const defaultVersionKey = (courseId: string) => `defaultVersion:${courseId}`;

interface JsonSettingsEntry {
  id: string;
  json: string;
}

export class CourseService {
  private storage: StorageAdapter;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  /**
   * يزرع الأصول المضمّنة في المخزن. تُستبدل الأصول دائماً بنسخة الحزمة
   * الحالية (فهي مرجع القراءة الوحيد للحقيقة)، بينما المسودّات لا تُمسّ.
   */
  async seed(): Promise<void> {
    const courses: Course[] = [];
    for (const [path, raw] of Object.entries(bundledOriginals)) {
      const parsed = parseCourse(raw);
      if (!parsed.ok) {
        console.error(`ملف أصلي تالف: ${path}`, parsed.issues);
        continue;
      }
      courses.push(parsed.course);
    }
    await this.storage.putMany('courses', courses);
    await this.storage.put<SettingsEntry>('settings', {
      id: SEED_MARKER_KEY,
      value: new Date().toISOString(),
    });
  }

  /** @param trainerNo يقصر القائمة على مقررات هذا المدرب (تقييد بالنطاق). */
  async list(trainerNo?: string): Promise<CourseListItem[]> {
    const [courses, drafts, assignments, versions] = await Promise.all([
      this.storage.getAll<Course>('courses'),
      this.storage.getAll<CourseDraft>('drafts'),
      this.storage.getAll<SS01Assignment>('assignments'),
      this.storage.getAll<CourseVersionEntity>('versions'),
    ]);
    const draftIds = new Set(drafts.map((d) => d.courseId));
    const names = this.displayNames(assignments);
    const trainersByCourse = new Map<string, string[]>();
    for (const a of assignments) {
      trainersByCourse.set(a.courseId, [
        ...(trainersByCourse.get(a.courseId) ?? []),
        names.get(a.trainerNo) ?? a.trainerName,
      ]);
    }
    const versionCount = new Map<string, number>();
    for (const v of versions) {
      versionCount.set(v.courseId, (versionCount.get(v.courseId) ?? 0) + 1);
    }
    const allowed = trainerNo
      ? new Set(assignments.filter((a) => a.trainerNo === trainerNo).map((a) => a.courseId))
      : null;

    return courses
      .filter((c) => !allowed || allowed.has(c.id))
      .map((c) => ({
        id: c.id,
        displayCode: c.displayCode,
        rayatCode: c.rayatCode,
        name: c.name,
        level: c.level,
        contactHours: c.contactHours,
        trainingType: c.trainingType,
        hasDraft: draftIds.has(c.id),
        trainers: trainersByCourse.get(c.id) ?? [],
        versionCount: versionCount.get(c.id) ?? 0,
      }))
      .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  }

  async view(courseId: string): Promise<CourseView | null> {
    const original = await this.storage.get<Course>('courses', courseId);
    if (!original) return null;
    const draft = (await this.storage.get<CourseDraft>('drafts', courseId)) ?? null;
    const entities = (await this.storage.findBy<CourseVersionEntity>(
      'versions', 'courseId', courseId,
    )).sort((a, b) => a.seq - b.seq);
    const defaultVersion = await this.getDefaultVersion(courseId);

    // الإصدار المعروض: الأحدث افتراضاً، أو الأصل/تسلسل محدد عند الرجوع
    let versionCourse: Course | null = null;
    if (defaultVersion !== 'original' && entities.length > 0) {
      const chosen =
        defaultVersion === 'latest'
          ? entities[entities.length - 1]
          : entities.find((v) => v.seq === defaultVersion);
      if (chosen) {
        const parsed = parseCourse(chosen.course);
        versionCourse = parsed.ok ? parsed.course : null;
      }
    }

    const effective = draft?.course ?? versionCourse ?? original;
    return {
      original,
      draft,
      versions: entities.map((v) => ({
        seq: v.seq,
        author: v.author,
        note: v.note,
        createdAt: v.createdAt,
      })),
      defaultVersion,
      effective,
      effectiveSource: draft ? 'draft' : versionCourse ? 'version' : 'original',
    };
  }

  /**
   * يحفظ مسودّة التحرير. يُتحقق من الملف بالمخطط قبل الكتابة — مسودّة
   * تكسر الثوابت (مجموع الدرجات مثلاً) تُرفض برسالة لا تُكتب صامتة.
   */
  async saveDraft(courseId: string, course: Course): Promise<{ ok: true } | { ok: false; message: string }> {
    const parsed = parseCourse(course);
    if (!parsed.ok) {
      return {
        ok: false,
        message: parsed.issues.map((i) => `${i.path}: ${i.message}`).join(' • '),
      };
    }
    await this.storage.put<CourseDraft>('drafts', {
      id: courseId,
      courseId,
      course: parsed.course,
      updatedAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  /** يسقط المسودّة فيعود المقرر لأصله. */
  async discardDraft(courseId: string): Promise<void> {
    await this.storage.remove('drafts', courseId);
  }

  /** طول الفصل المختار — إعداد عام واحد لكل الجهاز. */
  async getSemesterLength(): Promise<SemesterLength> {
    const entry = await this.storage.get<SettingsEntry>('settings', SEMESTER_LENGTH_KEY);
    const value = Number(entry?.value);
    return value === 17 || value === 18 ? value : 19;
  }

  async setSemesterLength(length: SemesterLength): Promise<void> {
    await this.storage.put<SettingsEntry>('settings', {
      id: SEMESTER_LENGTH_KEY,
      value: String(length),
    });
  }

  async isSeeded(): Promise<boolean> {
    const marker = await this.storage.get<SettingsEntry>('settings', SEED_MARKER_KEY);
    return marker !== undefined && (await this.storage.count('courses')) > 0;
  }

  /* ───────── روابط SS01: مقرر ↔ مدرب ───────── */

  /**
   * يستورد تقرير SS01 فيستبدل روابط المقررات بالمدربين استبدالاً كاملاً
   * (التقرير يُحدَّث مرة أو مرتين في الفصل)، ويزرع ملف مدربٍ أوليّاً لكل
   * مدرب جديد دون المساس بملفات المدربين المحفوظة.
   */
  async importSS01(text: string): Promise<
    | { ok: true; assignmentCount: number; trainerCount: number; term: string }
    | { ok: false; message: string }
  > {
    const courses = await this.storage.getAll<Course>('courses');
    const known = new Map(courses.map((c) => [c.rayatCode, c.id]));
    const result = parseSS01(text, known);
    if (!result.ok) return { ok: false, message: result.message ?? 'تعذر تحليل الملف.' };

    await this.storage.clear('assignments');
    await this.storage.putMany('assignments', result.assignments);

    // ملف أوّلي لكل مدرب جديد: الاسم كما ورد في التقرير، والبريد والمكتب
    // من البيانات المعتمدة إن وُجدت (والمبنى يُشتق من المكتب). الملف
    // المزروع آلياً (لم يحفظه صاحبه) يُحدَّث اسمه من التقرير في كل رفع؛
    // أما ما حفظه صاحبه فلا يُمسّ — تُستكمل فيه الحقول الفارغة فقط.
    const trainerNos = [...new Set(result.assignments.map((a) => a.trainerNo))];
    for (const a of result.assignments) {
      const known = KNOWN_TRAINERS[a.trainerNo];
      const office = known?.office ?? '';
      const building = office ? buildingFromOffice(office) : '';
      const existing = await this.storage.get<TrainerProfile>('trainerProfiles', a.trainerNo);
      if (!existing) {
        await this.storage.put<TrainerProfile>('trainerProfiles', {
          id: a.trainerNo,
          trainerNo: a.trainerNo,
          name: a.trainerName,
          email: known?.email ?? '',
          whatsapp: '',
          building,
          office,
          channels: { email: true, officeHours: true, whatsapp: false, other: false, otherValue: '' },
          officeHours: ['الأحد', 'الأثنين', 'الثلاثاء', 'الاربعاء', 'الخميس'].map((day) => ({
            day, from: '', to: '',
          })),
          updatedAt: '',
        });
      } else if (!existing.updatedAt) {
        await this.storage.put<TrainerProfile>('trainerProfiles', {
          ...existing,
          name: a.trainerName,
          email: existing.email || known?.email || '',
          office: office || existing.office,
          building: office ? building : existing.building,
        });
      } else if (known) {
        // ملف حفظه صاحبه: لا يُستبدل شيء، ويُملأ الفارغ فقط
        const patched: TrainerProfile = {
          ...existing,
          email: existing.email || known.email,
          office: existing.office || office,
          building: existing.building || (existing.office ? '' : building),
        };
        if (
          patched.email !== existing.email ||
          patched.office !== existing.office ||
          patched.building !== existing.building
        ) {
          await this.storage.put<TrainerProfile>('trainerProfiles', patched);
        }
      }
    }

    await this.storage.put<JsonSettingsEntry>('settings', {
      id: SS01_META_KEY,
      json: JSON.stringify({
        term: result.term,
        importedAt: new Date().toISOString(),
        assignmentCount: result.assignments.length,
      }),
    });
    return {
      ok: true,
      assignmentCount: result.assignments.length,
      trainerCount: trainerNos.length,
      term: result.term,
    };
  }

  /** بيان آخر استيراد لتقرير SS01 (أو null قبل أول رفع). */
  async getSS01Meta(): Promise<{ term: string; importedAt: string; assignmentCount: number } | null> {
    const entry = await this.storage.get<JsonSettingsEntry>('settings', SS01_META_KEY);
    return entry?.json ? JSON.parse(entry.json) : null;
  }

  /**
   * أسماء العرض: اسم التقرير كما هو، وعند تشابه اسمين برقمين وظيفيين
   * مختلفين يُفرَّق بالاسم الكامل المعتمد (أو بالرقم إن لم يُعتمد بعد).
   */
  private displayNames(assignments: SS01Assignment[]): Map<string, string> {
    const byNo = new Map<string, string>();
    for (const a of assignments) byNo.set(a.trainerNo, a.trainerName);
    const counts = new Map<string, number>();
    for (const name of byNo.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
    for (const [no, name] of byNo) {
      if ((counts.get(name) ?? 0) > 1) {
        byNo.set(no, KNOWN_TRAINERS[no]?.name ?? `${name} (${no})`);
      }
    }
    return byNo;
  }

  /** مدربو القسم من الروابط، بأسمائهم كما وردت في التقرير، مرتّبين بالاسم. */
  async listTrainers(): Promise<TrainerListItem[]> {
    const assignments = await this.storage.getAll<SS01Assignment>('assignments');
    const names = this.displayNames(assignments);
    const byNo = new Map<string, TrainerListItem>();
    for (const a of assignments) {
      const item = byNo.get(a.trainerNo) ?? {
        trainerNo: a.trainerNo,
        name: names.get(a.trainerNo) ?? a.trainerName,
        courseIds: [],
      };
      if (!item.courseIds.includes(a.courseId)) item.courseIds.push(a.courseId);
      byNo.set(a.trainerNo, item);
    }
    return [...byNo.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }

  /** المدرب المختار في هذا الجهاز — يقيّد الفهرس ويوقّع الوثيقة والتصدير. */
  async getActiveTrainerNo(): Promise<string | null> {
    const entry = await this.storage.get<SettingsEntry>('settings', ACTIVE_TRAINER_KEY);
    return entry?.value || null;
  }

  async setActiveTrainer(trainerNo: string | null): Promise<void> {
    await this.storage.put<SettingsEntry>('settings', {
      id: ACTIVE_TRAINER_KEY,
      value: trainerNo ?? '',
    });
  }

  /* ───────── الإصدارات: تصدير التعديل ورفعه والرجوع ───────── */

  /**
   * يبني ملف التصدير من مسودّة المدرب (أو النسخة الفعلية إن لم توجد
   * مسودّة) موقّعاً باسمه. الواجهة تتولى تنزيله ملفاً.
   */
  async exportVersionFile(courseId: string): Promise<
    | { ok: true; file: VersionFile; suggestedName: string }
    | { ok: false; message: string }
  > {
    const view = await this.view(courseId);
    if (!view) return { ok: false, message: 'المقرر غير موجود.' };
    const trainer = await this.getTrainer();
    const exportedAt = new Date().toISOString();
    const file: VersionFile = {
      kind: 'tvtc-course-version',
      formatVersion: 1,
      courseId,
      author: { trainerNo: trainer.trainerNo, name: trainer.name },
      exportedAt,
      note: '',
      course: view.draft?.course ?? view.effective,
    };
    const stamp = exportedAt.slice(0, 10).replaceAll('-', '');
    return {
      ok: true,
      file,
      suggestedName: `${courseId}_${trainer.trainerNo}_${stamp}.json`,
    };
  }

  /**
   * يرفع ملف إصدار مُصدَّراً فيصير الإصدار المعتمد الأحدث (المعروض
   * افتراضاً). يتحقق من الغلاف ومن ملف المقرر نفسه قبل القبول.
   */
  async importVersionFile(raw: unknown): Promise<
    | { ok: true; seq: number; courseId: string }
    | { ok: false; message: string }
  > {
    const wrapper = versionFileSchema.safeParse(raw);
    if (!wrapper.success) {
      return { ok: false, message: 'ليس ملف إصدار صادراً من هذا النظام.' };
    }
    const { courseId } = wrapper.data;
    const original = await this.storage.get<Course>('courses', courseId);
    if (!original) {
      return { ok: false, message: `الملف لمقرر غير معروف (${courseId}).` };
    }
    const parsed = parseCourse(wrapper.data.course);
    if (!parsed.ok) {
      return {
        ok: false,
        message: `ملف المقرر داخل الإصدار تالف: ${parsed.issues[0]?.message ?? ''}`,
      };
    }
    if (parsed.course.id !== courseId) {
      return { ok: false, message: 'معرّف المقرر داخل الملف لا يطابق غلافه.' };
    }

    const existing = await this.storage.findBy<CourseVersionEntity>(
      'versions', 'courseId', courseId,
    );
    const seq = existing.reduce((max, v) => Math.max(max, v.seq), 0) + 1;
    await this.storage.put<CourseVersionEntity>('versions', {
      id: `${courseId}@${seq}`,
      courseId,
      seq,
      author: wrapper.data.author,
      note: wrapper.data.note,
      exportedAt: wrapper.data.exportedAt,
      createdAt: new Date().toISOString(),
      course: parsed.course,
    });
    // الرفع الجديد يعيد المؤشر للأحدث — قاعدة «الافتراضي هو الأحدث»
    await this.setDefaultVersion(courseId, 'latest');
    return { ok: true, seq, courseId };
  }

  /** مؤشر العرض الافتراضي للمقرر: الأحدث ما لم يُسجَّل رجوعٌ صريح. */
  async getDefaultVersion(courseId: string): Promise<DefaultVersionPointer> {
    const entry = await this.storage.get<SettingsEntry>(
      'settings', defaultVersionKey(courseId),
    );
    if (!entry?.value || entry.value === 'latest') return 'latest';
    if (entry.value === 'original') return 'original';
    const seq = Number(entry.value);
    return Number.isInteger(seq) && seq > 0 ? seq : 'latest';
  }

  /** الرجوع: يجعل الأصل أو إصداراً محدداً هو المعروض افتراضاً. */
  async setDefaultVersion(courseId: string, pointer: DefaultVersionPointer): Promise<void> {
    await this.storage.put<SettingsEntry>('settings', {
      id: defaultVersionKey(courseId),
      value: String(pointer),
    });
  }

  /* ───────── ملف المدرب ورئيس القسم (تُحفظ مرة وتسري على كل المقررات) ───────── */

  /** المدرب النشط: المحفوظ في المخزن، وإلا النموذج المضمّن مع الحزمة. */
  async getTrainer(): Promise<TrainerProfile> {
    const active = await this.storage.get<SettingsEntry>('settings', ACTIVE_TRAINER_KEY);
    const fallback = trainerProfileSchema.parse(defaultTrainerJson);
    if (!active?.value) return fallback;
    const stored = await this.storage.get<TrainerProfile & { id: string }>(
      'trainerProfiles',
      active.value,
    );
    if (!stored) return fallback;
    const parsed = trainerProfileSchema.safeParse(stored);
    return parsed.success ? parsed.data : fallback;
  }

  async saveTrainer(profile: TrainerProfile): Promise<{ ok: true } | { ok: false; message: string }> {
    const parsed = trainerProfileSchema.safeParse(profile);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues.map((i) => i.message).join(' • ') };
    }
    // ختم الحفظ يميّز ملفاً حفظه صاحبه عن المزروع آلياً — المحفوظ لا
    // يُعاد اسمه من التقرير عند إعادة رفع SS01.
    await this.storage.put('trainerProfiles', {
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    });
    await this.storage.put<SettingsEntry>('settings', {
      id: ACTIVE_TRAINER_KEY,
      value: parsed.data.id,
    });
    return { ok: true };
  }

  /** رئيس القسم: المحفوظ في الإعدادات، وإلا ثابت القسم الافتراضي. */
  async getDepartmentHead(): Promise<ContactBlock> {
    const entry = await this.storage.get<JsonSettingsEntry>('settings', DEPARTMENT_HEAD_KEY);
    if (!entry?.json) return DEFAULT_DEPARTMENT.headOfDepartment;
    const parsed = contactBlockSchema.safeParse(JSON.parse(entry.json));
    return parsed.success ? parsed.data : DEFAULT_DEPARTMENT.headOfDepartment;
  }

  async saveDepartmentHead(head: ContactBlock): Promise<{ ok: true } | { ok: false; message: string }> {
    const parsed = contactBlockSchema.safeParse(head);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues.map((i) => i.message).join(' • ') };
    }
    await this.storage.put<JsonSettingsEntry>('settings', {
      id: DEPARTMENT_HEAD_KEY,
      json: JSON.stringify(parsed.data),
    });
    return { ok: true };
  }
}

let serviceInstance: CourseService | null = null;

/** مدخل الواجهة: يهيّئ المخزن ويزرع الأصول عند أول تشغيل. */
export async function getCourseService(): Promise<CourseService> {
  if (serviceInstance) return serviceInstance;
  const storage = await getStorage();
  const service = new CourseService(storage);
  // الأصول تُعاد زراعتها في كل إقلاع: الحزمة هي مصدر الحقيقة للأصل،
  // وأي تحديث للمولّد يصل للمستخدم تلقائياً دون مساس بمسودّاته.
  await service.seed();
  serviceInstance = service;
  return service;
}

/** للاختبارات: إسقاط المفردة. */
export function resetCourseService(): void {
  serviceInstance = null;
}

/** يتحقق أن أسماء المجموعات المستخدمة هنا معرّفة في مخطط المخزن. */
const _usedCollections: (keyof typeof COLLECTIONS)[] = [
  'courses',
  'drafts',
  'settings',
  'trainerProfiles',
  'assignments',
  'versions',
];
void _usedCollections;
