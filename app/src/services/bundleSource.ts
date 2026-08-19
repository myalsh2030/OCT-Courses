import { z } from 'zod';
import { vaultBundleSchema, type VaultBundle } from '../domain/bundle';
import { readTerm } from '../domain/term';

/**
 * مصدر حزم الفصول المنشورة.
 *
 * الموقع ثابت بلا خادم، فالبيانات ملفّان في `public/data`:
 * `terms.json` يسرد الفصول المتاحة (الأحدث أولاً)، و`ss01-<الفصل>.enc.json`
 * حزمة كل فصل معمّاة. تُبنى بالسكربت `scripts/build-bundle.ts` من تقرير
 * رايات وتُلتزم للمستودع.
 *
 * كل تعذّر هنا يعود **رسالةً عربية تقول ما الذي لم يوجد وما العمل** — لا
 * استثناءً يُسقط الشاشة بيضاء أمام مدربٍ لا حيلة له فيه.
 */

const DATA_DIR = 'data';

export const termEntrySchema = z.object({
  /** رمز الفصل كما في رايات: `144710`. */
  term: z.string(),
  /** متى بُنيت الحزمة (ISO) — للاطمئنان أن المنشور حديث. */
  builtAt: z.string().default(''),
  /** عدد المدربين في الحزمة (سجلاتها). */
  trainers: z.number().int().nonnegative().default(0),
  /** عدد الشعب المسندة (مداخلها). */
  sections: z.number().int().nonnegative().default(0),
});

export const termsManifestSchema = z.object({
  terms: z.array(termEntrySchema),
});

export type TermEntry = z.infer<typeof termEntrySchema>;

/** جذر الأصول: `/` محلياً و`/MaintCourses/` بعد البناء. */
function dataUrl(file: string): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}${DATA_DIR}/${file}`;
}

export type TermsResult =
  | { ok: true; terms: TermEntry[] }
  | { ok: false; message: string };

/** اسم ملف حزمة فصل — القاعدة معرَّفة هنا وحدها. */
export function bundleFileName(term: string): string {
  return `ss01-${readTerm(term).code || term}.enc.json`;
}

async function fetchJson(
  file: string,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetch(dataUrl(file), { cache: 'no-cache' });
  } catch {
    return {
      ok: false,
      message: 'تعذّر الوصول إلى بيانات الموقع. تحقّق من اتصالك ثم أعد تحميل الصفحة.',
    };
  }
  if (response.status === 404) {
    return { ok: false, message: `الملف «${file}» غير منشور على الموقع.` };
  }
  if (!response.ok) {
    return { ok: false, message: `تعذّر تحميل «${file}» (رمز ${response.status}).` };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, message: `الملف «${file}» ليس JSON صالحاً — الحزمة المنشورة تالفة.` };
  }
}

/** يجلب مانيفست الفصول المتاحة، الأحدث أولاً. */
export async function loadTerms(): Promise<TermsResult> {
  const raw = await fetchJson('terms.json');
  if (!raw.ok) {
    return {
      ok: false,
      message: `${raw.message} لم تُنشر بيانات أي فصل تدريبي بعد — راجع رئيس القسم.`,
    };
  }
  const parsed = termsManifestSchema.safeParse(raw.body);
  if (!parsed.success) {
    return { ok: false, message: 'قائمة الفصول المنشورة بصيغة غير متوقَّعة — راجع رئيس القسم.' };
  }
  if (parsed.data.terms.length === 0) {
    return { ok: false, message: 'لا يوجد فصل تدريبي منشور بعد — راجع رئيس القسم.' };
  }
  return { ok: true, terms: parsed.data.terms };
}

export type BundleResult =
  | { ok: true; bundle: VaultBundle }
  | { ok: false; message: string };

/** يجلب حزمة فصلٍ بعينه ويتحقق من شكلها قبل تسليمها. */
export async function loadBundle(term: string): Promise<BundleResult> {
  const file = bundleFileName(term);
  const raw = await fetchJson(file);
  if (!raw.ok) {
    return { ok: false, message: `${raw.message} حزمة ${readTerm(term).label} غير متاحة.` };
  }
  const parsed = vaultBundleSchema.safeParse(raw.body);
  if (!parsed.success) {
    return {
      ok: false,
      message: `حزمة ${readTerm(term).label} بصيغة غير متوقَّعة — راجع رئيس القسم.`,
    };
  }
  return { ok: true, bundle: parsed.data };
}
