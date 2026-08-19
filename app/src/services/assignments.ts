import type { TrainerRecord } from '../domain/bundle';
import type { SS01Assignment } from '../domain/ss01';

/**
 * تحويل سجل المدرب المفكوك من حزمة الفصل إلى روابط «مقرر ↔ مدرب».
 *
 * دالة خالصة بلا تخزين: مدخلها سجلٌ وخريطةُ المقررات المعروفة، ومخرجها
 * الروابط ورموزُ ما لا توصيف له. فُصلت عن الخدمة لأنها قاعدة ربطٍ تُختبر
 * وحدها — والشعبة قد تتكرر بلقاءات، والمقرر قد يحمل شعباً عدة.
 */

export interface RecordAssignments {
  assignments: SS01Assignment[];
  /** رموز رايات لمقررات مسندة لا توصيف تفصيلي لها في بيانات التطبيق. */
  unknownRayatCodes: string[];
}

/**
 * @param knownByRayat خريطة `رمز رايات ← معرّف المقرر` للمقررات الموصَّفة.
 */
export function assignmentsFromRecord(
  record: TrainerRecord,
  knownByRayat: Map<string, string>,
): RecordAssignments {
  const byCourse = new Map<string, SS01Assignment>();
  const unknown = new Set<string>();

  for (const section of record.sections) {
    const courseId = knownByRayat.get(section.rayatCode);
    if (!courseId) {
      unknown.add(section.rayatCode);
      continue;
    }
    const id = `${courseId}|${record.trainerNo}`;
    let assignment = byCourse.get(id);
    if (!assignment) {
      assignment = {
        id,
        courseId,
        rayatCode: section.rayatCode,
        courseName: section.courseName,
        trainerNo: record.trainerNo,
        trainerName: record.trainerName,
        sections: [],
        term: record.term,
      };
      byCourse.set(id, assignment);
    }
    if (!assignment.sections.some((s) => s.ref === section.ref)) {
      assignment.sections.push({ ref: section.ref, type: section.type });
    }
  }

  return {
    assignments: [...byCourse.values()],
    unknownRayatCodes: [...unknown].sort(),
  };
}
