import { buildingFromOffice, type TrainerProfile } from '../domain/department';
import type { SS01Assignment } from '../domain/ss01';
import type { StorageAdapter } from '../storage';
import knownTrainersJson from '../data/trainers/known-trainers.json';

/**
 * دورة حياة ملف المدرب — الحقول التي لا يوفّرها تقرير رايات.
 *
 * القاعدة الحاكمة (قرار المالك ٢٠٢٦-٠٨-٠٢): **ما حفظه المدرب بنفسه لا
 * يُمسّ**. الملف المزروع آلياً (بلا ختم `updatedAt`) يتبع التقرير في
 * اسمه ويُستكمل من البيانات المعتمدة؛ والملف المحفوظ لا يُستبدل منه شيء،
 * وإنما يُملأ الفارغ فقط.
 *
 * فُصلت هنا عن `courseService` لأنها شأنُ المنسوبين لا شأنُ المقررات،
 * ويشترك فيها مدخلان: رفعُ الأدمن للتقرير، ودخولُ المدرب بحزمة الفصل.
 */

/**
 * بيانات المدربين المعتمدة من المالك. الغرض منها تعبئة ما لا يوفّره تقرير
 * رايات في القالب: البريد ورقم المكتب (والمبنى مشتق من المكتب). الأسماء
 * المعروضة تبقى كما وردت في التقرير، ولا يُستدعى الاسم الكامل هنا إلا
 * للتفريق حين يتشابه اسمان برقمين وظيفيين مختلفين.
 */
export const KNOWN_TRAINERS = knownTrainersJson as Record<
  string,
  { name: string; email: string; office?: string }
>;

/** أيام الساعات المكتبية الخمسة كما في النموذج الرسمي. */
const WEEK_DAYS = ['الأحد', 'الأثنين', 'الثلاثاء', 'الاربعاء', 'الخميس'] as const;

/**
 * ملف مدربٍ أوليّ: اسمه كما ورد في مصدره، وبريده ومكتبه من البيانات
 * المعتمدة إن وُجدت (والمبنى مشتق من المكتب). `updatedAt` فارغ علامةً
 * على أنه مزروع آلياً لم يحفظه صاحبه بعد.
 */
export function blankTrainerProfile(trainerNo: string, name: string): TrainerProfile {
  const known = KNOWN_TRAINERS[trainerNo];
  const office = known?.office ?? '';
  return {
    id: trainerNo,
    trainerNo,
    name,
    email: known?.email ?? '',
    whatsapp: '',
    building: office ? buildingFromOffice(office) : '',
    office,
    channels: { email: true, officeHours: true, whatsapp: false, other: false, otherValue: '' },
    officeHours: WEEK_DAYS.map((day) => ({ day, from: '', to: '' })),
    updatedAt: '',
  };
}

/**
 * يزرع ملفاً لكل مدرب في تقرير مرفوع، ويحدّث المزروع آلياً من التقرير.
 * يُستدعى عند رفع الأدمن للتقرير — فيمسّ **كل** مدربي القسم.
 */
export async function seedProfilesFromReport(
  storage: StorageAdapter,
  assignments: SS01Assignment[],
): Promise<void> {
  for (const a of assignments) {
    const known = KNOWN_TRAINERS[a.trainerNo];
    const office = known?.office ?? '';
    const building = office ? buildingFromOffice(office) : '';
    const existing = await storage.get<TrainerProfile>('trainerProfiles', a.trainerNo);

    if (!existing) {
      await storage.put<TrainerProfile>(
        'trainerProfiles',
        blankTrainerProfile(a.trainerNo, a.trainerName),
      );
      continue;
    }
    if (!existing.updatedAt) {
      await storage.put<TrainerProfile>('trainerProfiles', {
        ...existing,
        name: a.trainerName,
        email: existing.email || known?.email || '',
        office: office || existing.office,
        building: office ? building : existing.building,
      });
      continue;
    }
    if (!known) continue;

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
      await storage.put<TrainerProfile>('trainerProfiles', patched);
    }
  }
}

/**
 * يضمن ملفاً لمدربٍ واحد — مدخل دخول المدرب بحزمة الفصل، فلا يمسّ غيره.
 * يعيد الملف بعد الزرع أو الاستكمال.
 */
export async function ensureTrainerProfile(
  storage: StorageAdapter,
  trainerNo: string,
  name: string,
): Promise<TrainerProfile> {
  const existing = await storage.get<TrainerProfile>('trainerProfiles', trainerNo);
  const seed = blankTrainerProfile(trainerNo, name || existing?.name || '');

  let profile: TrainerProfile;
  if (!existing) {
    profile = seed;
  } else if (!existing.updatedAt) {
    profile = {
      ...existing,
      name: name || existing.name,
      email: existing.email || seed.email,
      office: existing.office || seed.office,
      building: existing.office ? existing.building : seed.building,
    };
  } else {
    profile = {
      ...existing,
      email: existing.email || seed.email,
      office: existing.office || seed.office,
      building: existing.building || (existing.office ? '' : seed.building),
    };
  }

  await storage.put<TrainerProfile>('trainerProfiles', profile);
  return profile;
}
