import {
  BACKUP_FORMAT_VERSION,
  BACKUP_KIND,
  backupFileName,
  specializationOf,
  type BackupCourse,
  type BackupFile,
} from '../domain/backup';
import { getCourseService } from './courseService';
import type { TrainerSession } from './session';

/**
 * بناء النسخة الاحتياطية وتطبيقها — فوق واجهة `CourseService` العامة
 * وحدها، فلا تعرف هذه الوحدة شيئاً عن IndexedDB ولا عن شكل المخزن.
 *
 * القاعدة: تُحفظ **جميع مقررات المدرب المسندة حالياً** لا المعدَّلة
 * فقط. رئيس القسم حين يستقبل الملف يريد ملف المدرب كاملاً لهذا الفصل،
 * ولأن المقرر بلا تعديل يُحفظ بنسخته الأصلية فحجمه ثمنٌ مقبول مقابل
 * ملفٍ واحد مكتفٍ بذاته.
 */

export interface BuiltBackup {
  file: BackupFile;
  fileName: string;
}

/** يبني ملف النسخة الاحتياطية للمدرب صاحب الجلسة. */
export async function buildBackupFile(
  session: TrainerSession,
  at: Date = new Date(),
): Promise<BuiltBackup> {
  const service = await getCourseService();
  const [list, profile, departmentHead] = await Promise.all([
    service.list(session.trainerNo),
    service.getTrainer(),
    service.getDepartmentHead(),
  ]);

  const courses: BackupCourse[] = [];
  for (const item of list) {
    const view = await service.view(item.id);
    if (!view) continue;
    courses.push({
      courseId: item.id,
      rayatCode: item.rayatCode,
      name: item.name,
      hasDraft: view.draft !== null,
      course: view.draft?.course ?? view.effective,
    });
  }

  // التخصص من رموز شعبه في رايات لا من المقررات الموصَّفة وحدها: المقرر
  // المسند بلا توصيف يبقى دالاً على تخصصه.
  const rayatCodes = session.record.sections.map((s) => s.rayatCode);
  const file: BackupFile = {
    kind: BACKUP_KIND,
    formatVersion: BACKUP_FORMAT_VERSION,
    term: session.term,
    trainerNo: session.trainerNo,
    trainerName: session.trainerName,
    department: session.department,
    specialization: specializationOf(rayatCodes),
    savedAt: at.toISOString(),
    profile,
    departmentHead,
    sections: session.record.sections.map((s) => ({
      rayatCode: s.rayatCode,
      courseName: s.courseName,
      ref: s.ref,
      type: s.type,
    })),
    courses,
  };

  return {
    file,
    fileName: backupFileName({
      rayatCodes,
      trainerNo: session.trainerNo,
      term: session.term,
      at,
    }),
  };
}

export interface RestoreOutcome {
  /** عدد المقررات التي أُعيدت مسوّداتها. */
  drafts: number;
  /** مقررات في الملف لا توصيف لها في هذا الموقع — تُذكر ولا تُبتلع. */
  skipped: string[];
  /** رسائل رفض التحقق لمقررات تالفة داخل الملف. */
  rejected: string[];
}

/**
 * يطبّق نسخةً احتياطية بعد تأكيد المدرب: ملفه الشخصي ورئيس قسمه
 * ومسوّداته. المقرر الذي حُفظ بلا تعديل لا تُكتب له مسودّة — نسخته
 * الأصلية موجودة أصلاً، وكتابتها مسودّةً تُظهر شارة «مسودّة» كاذبة.
 */
export async function applyBackup(file: BackupFile): Promise<RestoreOutcome> {
  const service = await getCourseService();
  const outcome: RestoreOutcome = { drafts: 0, skipped: [], rejected: [] };

  await service.saveTrainer(file.profile);
  if (file.departmentHead) await service.saveDepartmentHead(file.departmentHead);

  for (const entry of file.courses) {
    if (!entry.hasDraft) continue;
    const view = await service.view(entry.courseId);
    if (!view) {
      outcome.skipped.push(`${entry.rayatCode} — ${entry.name}`);
      continue;
    }
    const result = await service.saveDraft(entry.courseId, entry.course);
    if (result.ok) outcome.drafts += 1;
    else outcome.rejected.push(`${entry.rayatCode}: ${result.message}`);
  }

  return outcome;
}
