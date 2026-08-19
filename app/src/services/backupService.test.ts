import { beforeEach, describe, expect, it } from 'vitest';
import type { TrainerRecord } from '../domain/bundle';
import { readBackup } from '../domain/backup';
import { applyOwnReference, hasOwnReference } from '../domain/missing';
import { DB_NAME, resetStorage } from '../storage';
import { installSessionStorage } from '../test/sessionStorage';
import { applyBackup, buildBackupFile } from './backupService';
import { getCourseService, resetCourseService } from './courseService';
import type { TrainerSession } from './session';

/**
 * دورة النسخة الاحتياطية كاملة على المخزن الحقيقي (IndexedDB في الاختبار).
 *
 * المسألة التي يحرسها هذا الملف: أن الملف الواحد يكفي لإعادة كل شيء —
 * مقررات المدرب ومسوّداته وملفه الشخصي. فمسحُ متصفحه بعد إرسال نسخته
 * يجب ألّا يكلّفه عمل فصلٍ كامل.
 */

const section = (rayatCode: string, courseName: string, ref: string) => ({
  rayatCode,
  courseName,
  ref,
  type: 'نظري صباحي',
  meetings: [],
  capacity: 24,
  enrolled: 20,
  remaining: 4,
});

const RECORD: TrainerRecord = {
  term: '144710',
  trainerNo: '0013270',
  trainerName: 'محمد الشبيلي',
  department: 'التقنية الميكانيكية',
  sections: [
    section('مصيم-141', 'أساسيات ميكانيكا الموائع', '10630'),
    section('مصيم-141', 'أساسيات ميكانيكا الموائع', '10631'),
    section('مصيم-261', 'آلات دوارة (1)', '10638'),
  ],
};

const SESSION: TrainerSession = {
  term: '144710',
  trainerNo: '0013270',
  trainerName: 'محمد الشبيلي',
  department: 'التقنية الميكانيكية',
  at: '2026-08-19T10:00:00.000Z',
  record: RECORD,
};

const AT = new Date(2026, 7, 19);

function wipeDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await resetStorage();
  resetCourseService();
  await wipeDatabase();
  installSessionStorage();
  const service = await getCourseService();
  await service.applyTrainerRecord(RECORD);
});

describe('تطبيق سجل المدرب', () => {
  it('يربط مقرراته الموصَّفة ويسمّي ما لا توصيف له', async () => {
    const service = await getCourseService();
    const result = await service.applyTrainerRecord({
      ...RECORD,
      sections: [...RECORD.sections, section('كهرب-999', 'مقرر غير معروف', '10999')],
    });
    expect(result.assigned).toBe(2);
    expect(result.unknownRayatCodes).toEqual(['كهرب-999']);
  });

  it('يجعله المدرب النشط بملفٍ يحمل اسمه', async () => {
    const service = await getCourseService();
    expect(await service.getActiveTrainerNo()).toBe('0013270');
    const profile = await service.getTrainer();
    expect(profile.trainerNo).toBe('0013270');
    expect(profile.name).toBe('محمد الشبيلي');
  });
});

describe('بناء النسخة', () => {
  it('اسم الملف بالتخصص ورقم المدرب والفصل والتاريخ', async () => {
    const built = await buildBackupFile(SESSION, AT);
    expect(built.fileName).toBe('مصيم-0013270-144710-260819.json');
  });

  it('تحوي جميع مقرراته المسندة لا المعدَّلة وحدها', async () => {
    const built = await buildBackupFile(SESSION, AT);
    expect(built.file.courses.map((c) => c.courseId).sort()).toEqual(['MMIN-141', 'MMIN-261']);
    expect(built.file.courses.every((c) => !c.hasDraft)).toBe(true);
    expect(built.file.sections).toHaveLength(3);
    expect(built.file.profile.trainerNo).toBe('0013270');
  });

  it('وتحمل مسوّداته معلَّمةً حين توجد', async () => {
    const service = await getCourseService();
    const view = await service.view('MMIN-141');
    const course = structuredClone(view!.effective);
    course.references = applyOwnReference(course.references, {
      main: 'كتاب المقرر المعتمد',
      site: '',
      platform: '',
    });
    expect((await service.saveDraft('MMIN-141', course)).ok).toBe(true);

    const built = await buildBackupFile(SESSION, AT);
    const fluid = built.file.courses.find((c) => c.courseId === 'MMIN-141')!;
    expect(fluid.hasDraft).toBe(true);
    expect(hasOwnReference(fluid.course.references)).toBe(true);
  });
});

describe('الاستعادة', () => {
  it('تعيد المسوّدات والملف الشخصي بعد ضياعهما', async () => {
    const service = await getCourseService();

    // حالٌ سابقة: مرجع خاص في مقرر، وبريد وساعات مكتبية في ملفه
    const view = await service.view('MMIN-141');
    const course = structuredClone(view!.effective);
    course.references = applyOwnReference(course.references, {
      main: 'كتاب المقرر المعتمد',
      site: '',
      platform: '',
    });
    await service.saveDraft('MMIN-141', course);
    const profile = await service.getTrainer();
    await service.saveTrainer({
      ...profile,
      email: 'myalsh@tvtc.gov.sa',
      officeHours: profile.officeHours.map((d, i) =>
        i === 0 ? { ...d, from: '09 : 00', to: '10 : 00' } : d,
      ),
    });

    const built = await buildBackupFile(SESSION, AT);

    // ضياعٌ كامل: أُسقطت المسودّة وأُفرغ الملف
    await service.discardDraft('MMIN-141');
    await service.saveTrainer({
      ...(await service.getTrainer()),
      email: '',
      officeHours: profile.officeHours.map((d) => ({ ...d, from: '', to: '' })),
    });
    expect((await service.view('MMIN-141'))!.draft).toBeNull();

    const outcome = await applyBackup(built.file);
    expect(outcome).toMatchObject({ drafts: 1, skipped: [], rejected: [] });

    const restored = await service.view('MMIN-141');
    expect(restored!.draft).not.toBeNull();
    expect(hasOwnReference(restored!.effective.references)).toBe(true);
    const restoredProfile = await service.getTrainer();
    expect(restoredProfile.email).toBe('myalsh@tvtc.gov.sa');
    expect(restoredProfile.officeHours[0]).toMatchObject({ from: '09 : 00', to: '10 : 00' });
  });

  it('مقررٌ لا توصيف له هنا يُذكر ولا يُبتلع', async () => {
    const built = await buildBackupFile(SESSION, AT);
    const stranger = structuredClone(built.file.courses[0]);
    stranger.courseId = 'XXXX-999';
    stranger.rayatCode = 'كهرب-999';
    stranger.name = 'مقرر من قسم آخر';
    stranger.hasDraft = true;

    const outcome = await applyBackup({ ...built.file, courses: [stranger] });
    expect(outcome.drafts).toBe(0);
    expect(outcome.skipped).toEqual(['كهرب-999 — مقرر من قسم آخر']);
  });

  it('الملف المبني يُقرأ بقارئ الاستعادة نفسه ويلخَّص', async () => {
    const built = await buildBackupFile(SESSION, AT);
    const round = readBackup(JSON.parse(JSON.stringify(built.file)));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    expect(round.summary).toMatchObject({
      term: '144710',
      termLabel: 'الفصل التدريبي 144710',
      trainerNo: '0013270',
      specialization: 'مصيم',
      courses: 2,
      drafts: 0,
    });
  });
});
