import { openBundle, trainerRecordSchema, type TrainerRecord } from '../domain/bundle';
import { normalizeRef, normalizeTrainerNo } from '../domain/vault';
import { z } from 'zod';

/**
 * جلسة المدرب — سجلّه المفكوك في تبويب متصفحه وحده.
 *
 * تُحفظ في `sessionStorage` لا `localStorage`: بيانات المدرب تُفكّ عند
 * دخوله وتزول بإغلاق التبويب، فلا تبقى على جهاز مشترك بعد انصرافه.
 * وإعادة الدخول رخيصة (اشتقاق واحد)، فلا حاجة لإبقائها.
 */

export const SESSION_KEY = 'oct.trainer.session';

export const sessionSchema = z.object({
  term: z.string(),
  trainerNo: z.string(),
  trainerName: z.string(),
  department: z.string(),
  /** وقت الدخول (ISO) — يظهر في الترويسة ويُستعمل في اسم النسخة. */
  at: z.string(),
  record: trainerRecordSchema,
});

export type TrainerSession = z.infer<typeof sessionSchema>;

/**
 * رسالة الفشل **واحدة لا تتفرّع**.
 *
 * طبقة التعمية لا تميّز عمداً بين «رقم مدرب غير موجود» و«رقم مرجعي لا
 * يخصّه»: الفشل عندها واحد لا يتجزأ، لأن التمييز يخبر المجرِّب أي نصفَي
 * الزوج أصاب فيقرّبه من الجواب. فرسالة تقول «الرقم غير مسجل» تهدم ما
 * بنته الطبقة كلّه. لذلك رسالةٌ واحدة تشرح ما المتوقَّع بلا أن تكشف
 * أيّهما لم يطابق.
 */
export const SIGN_IN_FAILED =
  'لم نستطع فتح ملفك بهذين الرقمين. تأكّد أن الأول رقمك الوظيفي (الأصفار البادئة مقبولة)، وأن الثاني رقمٌ مرجعي لشعبة مسندة إليك في هذا الفصل كما يظهر في جدولك بنظام رايات. التحقق يجري على الملف المعمَّى نفسه، فلا يعرف النظام أيّ الرقمين لم يطابق.';

export type SignInResult =
  | { ok: true; session: TrainerSession }
  | { ok: false; message: string };

/**
 * يفتح سجل المدرب من حزمة الفصل ويبني جلسته.
 *
 * التطبيع كلّه من `vault.ts`: الأصفار البادئة والفراغات والأرقام
 * الهندية سواء (`١٣٢٧٠` = `13270` = `0013270`)، والرقم المرجعي أرقامٌ
 * فقط بلا حذف أصفاره.
 */
export async function signIn(
  bundle: unknown,
  term: string,
  trainerNo: string,
  refNo: string,
): Promise<SignInResult> {
  const no = normalizeTrainerNo(trainerNo);
  const ref = normalizeRef(refNo);
  if (!no || !ref) return { ok: false, message: SIGN_IN_FAILED };

  const record = await openBundle(bundle, no, ref);
  if (!record) return { ok: false, message: SIGN_IN_FAILED };

  return { ok: true, session: buildSession(record, term) };
}

/** يبني جلسةً من سجل مفكوك — منفصلة عن الفتح كي تُختبر وحدها. */
export function buildSession(record: TrainerRecord, term: string): TrainerSession {
  return {
    term: record.term || term,
    trainerNo: record.trainerNo,
    trainerName: record.trainerName,
    department: record.department,
    at: new Date().toISOString(),
    record,
  };
}

/** مخزن الجلسة، أو `null` في بيئة بلا `sessionStorage` (اختبار/تصفح مقيّد). */
function store(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function saveSession(session: TrainerSession): void {
  store()?.setItem(SESSION_KEY, JSON.stringify(session));
}

/** يقرأ الجلسة ويتحقق منها؛ الجلسة التالفة تُمسح ويُعامَل صاحبها كخارج. */
export function readSession(): TrainerSession | null {
  const raw = store()?.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // نصٌّ ليس JSON — يُعامَل كجلسة تالفة
  }
  clearSession();
  return null;
}

export function clearSession(): void {
  store()?.removeItem(SESSION_KEY);
}

/** أرقام المقررات المسندة بلا تكرار، بترتيب ورودها في السجل. */
export function assignedRayatCodes(record: TrainerRecord): string[] {
  return [...new Set(record.sections.map((s) => s.rayatCode))];
}
