/**
 * محلّل تقرير رايات SS01 (جدولة الشعب).
 *
 * الملف CSV بترويسة عربية وحقول مقتبسة وقد يبدأ بعلامة BOM. كل صف شعبةٌ
 * (وقد تتكرر الشعبة بصفوف لقاءات متعددة)، ومنه نستخرج روابط
 * «مقرر ↔ مدرب» لمقررات القسم المعروفة فقط — فهذه غاية الرفع: أن يعرف
 * كل مدرب خطط مقرراته. يُحدَّث الملف مرة أو مرتين في الفصل التدريبي،
 * وكل رفع يستبدل الروابط السابقة بالكامل.
 */

export interface SS01Assignment {
  /** معرّف الرابط: `courseId|trainerNo` — رابط واحد لكل مدرب في المقرر. */
  id: string;
  courseId: string;
  rayatCode: string;
  courseName: string;
  trainerNo: string;
  trainerName: string;
  /** الشعب التي يدرّسها هذا المدرب في هذا المقرر. */
  sections: { ref: string; type: string }[];
  /** الفصل التدريبي كما ورد في التقرير (مثل 144620). */
  term: string;
}

export interface SS01ParseResult {
  ok: boolean;
  /** روابط مقررات القسم المعروفة فقط. */
  assignments: SS01Assignment[];
  term: string;
  /** إجمالي صفوف الملف (للاطمئنان أن الملف سليم). */
  totalRows: number;
  /** رموز رايات وردت في الملف لمقررات غير معروفة لدينا (للإحاطة فقط). */
  unknownRayatCodes: string[];
  message?: string;
}

/** محلّل CSV بسيط يراعي الحقول المقتبسة والفواصل داخلها وأسطر CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const REQUIRED_HEADERS = ['المقرر', 'رقم المدرب', 'اسم المدرب', 'الرقم المرجعي'] as const;

/**
 * يحلّل نص تقرير SS01 ويعيد روابط المقررات المعروفة.
 * @param knownByRayat خريطة `رمز رايات ← معرّف المقرر` للمقررات المضمّنة.
 */
export function parseSS01(
  text: string,
  knownByRayat: Map<string, string>,
): SS01ParseResult {
  const empty = (message: string): SS01ParseResult => ({
    ok: false,
    assignments: [],
    term: '',
    totalRows: 0,
    unknownRayatCodes: [],
    message,
  });

  const rows = parseCsv(text);
  if (rows.length < 2) return empty('الملف فارغ أو ليس ملف CSV صالحاً.');

  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  for (const required of REQUIRED_HEADERS) {
    if (col(required) === -1) {
      return empty(`ليس تقرير SS01: عمود «${required}» غير موجود في الترويسة.`);
    }
  }

  const iTerm = col('الفصل التدريبي');
  const iCode = col('المقرر');
  const iName = col('اسم المقرر');
  const iRef = col('الرقم المرجعي');
  const iType = col('نوع الشعبة');
  const iTrainerNo = col('رقم المدرب');
  const iTrainerName = col('اسم المدرب');

  const byKey = new Map<string, SS01Assignment>();
  const unknown = new Set<string>();
  let term = '';

  for (const r of rows.slice(1)) {
    const rayatCode = (r[iCode] ?? '').trim();
    const trainerNo = (r[iTrainerNo] ?? '').trim();
    if (!rayatCode || !trainerNo) continue;
    term ||= (r[iTerm] ?? '').trim();

    const courseId = knownByRayat.get(rayatCode);
    if (!courseId) {
      unknown.add(rayatCode);
      continue;
    }

    const key = `${courseId}|${trainerNo}`;
    let assignment = byKey.get(key);
    if (!assignment) {
      assignment = {
        id: key,
        courseId,
        rayatCode,
        courseName: (r[iName] ?? '').trim(),
        trainerNo,
        trainerName: (r[iTrainerName] ?? '').trim(),
        sections: [],
        term: (r[iTerm] ?? '').trim(),
      };
      byKey.set(key, assignment);
    }
    const ref = (r[iRef] ?? '').trim();
    if (ref && !assignment.sections.some((s) => s.ref === ref)) {
      assignment.sections.push({ ref, type: (r[iType] ?? '').trim() });
    }
  }

  if (byKey.size === 0) {
    return empty('لا يحتوي التقرير على أي شعبة لمقررات القسم المعروفة.');
  }

  return {
    ok: true,
    assignments: [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id)),
    term,
    totalRows: rows.length - 1,
    unknownRayatCodes: [...unknown].sort(),
  };
}
