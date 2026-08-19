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
 * صفٌ من التقرير كما ورد — لقاءٌ واحد لشعبة، لا شعبة كاملة: تتكرر الشعبة
 * بصفوف حين تلتقي في أكثر من يوم أو قاعة. ورايات يكتب «-» في خانتي المدرب
 * حين لا مدرب للشعبة، فالحقل يبقى كما ورد ويطبّعه من يستهلكه.
 */
export interface SS01Row {
  term: string;
  /** القسم الأكاديمي كما في التقرير (التقنية الميكانيكية، الدراسات العامة…). */
  department: string;
  rayatCode: string;
  courseName: string;
  ref: string;
  type: string;
  day: string;
  time: string;
  building: string;
  room: string;
  capacity: string;
  enrolled: string;
  remaining: string;
  trainerNo: string;
  trainerName: string;
}

export interface SS01RowsResult {
  ok: boolean;
  rows: SS01Row[];
  term: string;
  message?: string;
}

/** أسماء الأعمدة العربية في تقرير رايات — الموضع الوحيد الذي يعرفها. */
const COLUMNS: Record<keyof SS01Row, string> = {
  term: 'الفصل التدريبي',
  department: 'القسم',
  rayatCode: 'المقرر',
  courseName: 'اسم المقرر',
  ref: 'الرقم المرجعي',
  type: 'نوع الشعبة',
  day: 'اليوم',
  time: 'الوقت',
  building: 'مبنى',
  room: 'قاعة',
  capacity: 'سعة',
  enrolled: 'مسجلين',
  remaining: 'متبقي',
  trainerNo: 'رقم المدرب',
  trainerName: 'اسم المدرب',
};

/**
 * القراءة الخام للتقرير: صفٌ مُسمّى الحقول لكل سطر بيانات، بلا تصفية ولا
 * تجميع. عليها يقوم `parseSS01` (روابط مقرر ↔ مدرب) وتقوم حزمة التعمية
 * (`bundle.ts`)، فلا يوجد في المشروع إلا قارئ واحد لهذا التقرير.
 * الأعمدة الغائبة تعود فارغة، والأعمدة الأربعة الأساسية شرطُ قبول الملف.
 */
export function readSS01Rows(text: string): SS01RowsResult {
  const fail = (message: string): SS01RowsResult => ({ ok: false, rows: [], term: '', message });

  const raw = parseCsv(text);
  if (raw.length < 2) return fail('الملف فارغ أو ليس ملف CSV صالحاً.');

  const header = raw[0].map((h) => h.trim());
  for (const required of REQUIRED_HEADERS) {
    if (header.indexOf(required) === -1) {
      return fail(`ليس تقرير SS01: عمود «${required}» غير موجود في الترويسة.`);
    }
  }

  const at = {} as Record<keyof SS01Row, number>;
  for (const [field, label] of Object.entries(COLUMNS) as [keyof SS01Row, string][]) {
    at[field] = header.indexOf(label);
  }

  const rows = raw.slice(1).map((r) => {
    const cell = (field: keyof SS01Row) => (at[field] === -1 ? '' : (r[at[field]] ?? '').trim());
    return {
      term: cell('term'),
      department: cell('department'),
      rayatCode: cell('rayatCode'),
      courseName: cell('courseName'),
      ref: cell('ref'),
      type: cell('type'),
      day: cell('day'),
      time: cell('time'),
      building: cell('building'),
      room: cell('room'),
      capacity: cell('capacity'),
      enrolled: cell('enrolled'),
      remaining: cell('remaining'),
      trainerNo: cell('trainerNo'),
      trainerName: cell('trainerName'),
    } satisfies SS01Row;
  });

  return { ok: true, rows, term: rows.find((r) => r.term)?.term ?? '' };
}

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

  const read = readSS01Rows(text);
  if (!read.ok) return empty(read.message ?? 'تعذر تحليل الملف.');

  const byKey = new Map<string, SS01Assignment>();
  const unknown = new Set<string>();
  let term = '';

  for (const row of read.rows) {
    if (!row.rayatCode || !row.trainerNo) continue;
    term ||= row.term;

    const courseId = knownByRayat.get(row.rayatCode);
    if (!courseId) {
      unknown.add(row.rayatCode);
      continue;
    }

    const key = `${courseId}|${row.trainerNo}`;
    let assignment = byKey.get(key);
    if (!assignment) {
      assignment = {
        id: key,
        courseId,
        rayatCode: row.rayatCode,
        courseName: row.courseName,
        trainerNo: row.trainerNo,
        trainerName: row.trainerName,
        sections: [],
        term: row.term,
      };
      byKey.set(key, assignment);
    }
    if (row.ref && !assignment.sections.some((s) => s.ref === row.ref)) {
      assignment.sections.push({ ref: row.ref, type: row.type });
    }
  }

  if (byKey.size === 0) {
    return empty('لا يحتوي التقرير على أي شعبة لمقررات القسم المعروفة.');
  }

  return {
    ok: true,
    assignments: [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id)),
    term,
    totalRows: read.rows.length,
    unknownRayatCodes: [...unknown].sort(),
  };
}
