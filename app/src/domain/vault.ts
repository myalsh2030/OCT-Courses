/**
 * طبقة التعمية — الحماية في الملف نفسه لا في شاشة الدخول.
 *
 * الموقع ثابت على GitHub Pages والمستودع عام، فأي ملف يُنشر يستطيع أي أحد
 * تنزيله. لذلك لا يُنشر تقرير الشعب نصاً صريحاً أبداً: يُشفَّر سجل كل مدرب
 * بمفتاح يُشتق مما يعرفه هو وحده — رقمه الوظيفي مع رقم مرجعي من شعبه.
 *
 * هذا الملف يعرف التعمية ولا يعرف المدربين: يشتق مفتاحاً من زوجٍ نصّي،
 * ويشفّر نصاً ويفكّه. بناء السجلات وقراءتها في `bundle.ts`.
 *
 * **حدّ هذه الحماية — يُقال صراحة**: هذه تعمية لا تشفير مؤسسي. تمنع التصفح
 * العابر والكشط الآلي وفهرسة محركات البحث منعاً تاماً، ولا تصمد أمام مهاجم
 * مصمّم يملك عتاداً يجرّب مليارات الاحتمالات (فضاء الزوج صغير: رقم مدرب من
 * سبع خانات مع رقم مرجعي من خمس). المنشور جداول شعب وأسماء منسوبين، لا
 * بيانات سرية، وهذا المستوى مناسب لها.
 *
 * كل شيء بـ Web Crypto في المتصفح: لا مكتبة خارجية، ولا خادم، ولا سرّ في
 * المستودع — الملح يُنشر مع الحزمة كما هو معتاد في PBKDF2، لأن سرّيته ليست
 * مطلوبة: وظيفته منع الجداول المحسوبة مسبقاً، لا إخفاء شيء.
 */

/** عدد دورات PBKDF2 الافتراضية للحزم المنشورة (تُخفَّض في الاختبارات وحدها). */
export const DEFAULT_ITERATIONS = 310_000;

/** طول متجه التهيئة المعتمد لـ AES-GCM: ١٢ بايت. */
const IV_BYTES = 12;

/** طول ملح الحزمة: ١٦ بايت عشوائية لكل فصل. */
const SALT_BYTES = 16;

/**
 * وسمان يفصلان استعمالي المادة المشتقة: نصفٌ يصير مفتاح تشفير، ونصفٌ يصير
 * معرّف السجل. الفصل مقصود — فوجود المعرّف في الملف المنشور لا يقرّب أحداً
 * من المفتاح خطوةً واحدة، لأن اشتقاق أحدهما من الآخر يستلزم عكس SHA-256.
 */
const KEY_LABEL = 'oct-vault-key-v1';
const ID_LABEL = 'oct-vault-id-v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** معاملات التعمية المنشورة مع الحزمة — الملح بترميز base64. */
export interface VaultParams {
  salt: string;
  iterations: number;
}

/** مفتاح مدخل واحد: معرّفه المعلن في الملف، ومفتاح فكّه الذي لا يُنشر. */
export interface EntryKey {
  /** بصمة ست عشرية (٦٤ خانة) — مفتاح المدخل في جدول `entries`. */
  entryId: string;
  key: CryptoKey;
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto;
  if (!api?.subtle) {
    throw new Error('Web Crypto غير متاح: التعمية تتطلب متصفحاً حديثاً على اتصال آمن (https).');
  }
  return api.subtle;
}

/**
 * توحيد الأرقام العربية-الهندية (٠١٢…) والفارسية (۰۱۲…) إلى أرقام لاتينية.
 * المدرب قد ينسخ رقمه من نظام يعرضه بالأرقام العربية، فلو جرّدناها مع سائر
 * غير الأرقام لخرج الحقل فارغاً ولاتُّهم الرقم الصحيح بالخطأ.
 */
function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    const zero = code <= 0x0669 ? 0x0660 : 0x06f0;
    return String(code - zero);
  });
}

/**
 * تطبيع رقم المدرب: يُجرَّد من كل ما ليس رقماً، ثم من الأصفار البادئة، ثم
 * يُبطَّن إلى سبع خانات. فـ`13270` و`013270` و`0013270` و` 13270 ` كلها
 * `0013270` — لأن المدرب يكتب رقمه كما اعتاده لا كما يكتبه رايات.
 * ما لا رقم فيه («-» في التقرير لشعبة بلا مدرب) يعود فارغاً.
 */
export function normalizeTrainerNo(input: string): string {
  const digits = toLatinDigits(input ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+/, '').padStart(7, '0');
}

/**
 * تطبيع الرقم المرجعي: أرقام فقط بلا فراغات ولا محارف أخرى.
 * لا تُحذف أصفاره البادئة — أرقام رايات المرجعية لا تبدأ بصفر، وحذفها
 * يجعل رقمين مختلفين واحداً.
 */
export function normalizeRef(input: string): string {
  return toLatinDigits(input ?? '').replace(/\D/g, '');
}

/* ───────────────────────── ترميز ───────────────────────── */

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // تقطيع يمنع تجاوز مكدس الاستدعاء في المصفوفات الكبيرة
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}

/** ملح جديد للفصل — يُولَّد مرة عند بناء الحزمة ويُنشر معها. */
export function randomSalt(): string {
  return toBase64(globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/* ───────────────────────── الاشتقاق ───────────────────────── */

/**
 * يشتق من الزوج (رقم المدرب، رقم مرجعي) مفتاحَ AES-GCM ومعرّفَ المدخل.
 *
 * الخطوة البطيئة PBKDF2-SHA256 على `${رقم المدرب}:${الرقم المرجعي}` بملح
 * الحزمة ودوراتها، وتُنتج ٢٥٦ بتاً من المادة الأساس. ثم تُوسَّع المادة
 * بـ SHA-256 مرتين بوسمين مختلفين: نصفٌ مفتاحاً ونصفٌ معرّفاً. التوسيع
 * رخيص فلا نضاعف كلفة PBKDF2، والفصل بالوسم يمنع أن يفيد أحدهما في الآخر.
 */
export async function deriveEntryKey(
  trainerNo: string,
  refNo: string,
  params: VaultParams,
): Promise<EntryKey> {
  const passphrase = `${normalizeTrainerNo(trainerNo)}:${normalizeRef(refNo)}`;
  const material = await subtle().importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const master = new Uint8Array(
    await subtle().deriveBits(
      {
        name: 'PBKDF2',
        salt: fromBase64(params.salt),
        iterations: params.iterations,
        hash: 'SHA-256',
      },
      material,
      256,
    ),
  );

  const keyBytes = await sha256(concat(master, encoder.encode(KEY_LABEL)));
  const idBytes = await sha256(concat(master, encoder.encode(ID_LABEL)));
  const key = await subtle().importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  return { entryId: toHex(idBytes), key };
}

/* ───────────────────────── مفتاح السجل ───────────────────────── */

/** مفتاح سجلٍ عشوائي: صورته المستوردة للتشفير، ومادته الخام لتُغلَّف. */
export interface RecordKey {
  key: CryptoKey;
  raw: Uint8Array<ArrayBuffer>;
}

/**
 * مفتاح AES-GCM عشوائي ٢٥٦ بتاً لسجل مدرب واحد.
 *
 * وجوده هو ما يجعل التخزين على مستويين ممكناً: السجل يُشفَّر مرة واحدة بهذا
 * المفتاح، ولا يتكرر مع كل رقم مرجعي إلا المفتاح مغلّفاً — وهو ٣٢ بايت لا
 * سجلٌ كامل. وعشوائيته شرط: لو اشتُقّ من رقم المدرب لصار وجوده تسريباً.
 */
export async function randomRecordKey(): Promise<RecordKey> {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return { key: await importRecordKey(raw), raw };
}

/** يستورد مادة مفتاح سجل (٣٢ بايت) مفتاحاً صالحاً للتشفير والفك. */
export async function importRecordKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * معرّف عشوائي ست عشري (١٦ بايت افتراضاً) — لمعرّفات السجلات.
 * لا يُشتق من شيء: لا من رقم المدرب ولا من اسمه، فلا يدل على صاحبه.
 */
export function randomId(bytes = 16): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/* ───────────────────────── التشفير ───────────────────────── */

/**
 * يشفّر بايتات بـ AES-GCM بمتجه تهيئة عشوائي يُلحق بأول النص المشفّر،
 * والناتج base64 صالح للحفظ في JSON. المتجه الجديد لكل عملية شرطُ أمان
 * AES-GCM، وإعلانه لا يضرّ — سرّيته ليست مطلوبة.
 */
export async function sealBytes(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return toBase64(concat(iv, cipher));
}

/**
 * يفكّ ما شفّره `sealBytes`، ويعيد `null` عند أي فشل — مفتاح خاطئ، أو نص
 * مبتور، أو ترميز فاسد. لا يميّز بين أسباب الفشل ولا يرمي استثناءً، فالتمييز
 * نفسه تسريب: من يعرف «لماذا فشل» يعرف نصف الجواب.
 */
export async function unsealBytes(
  key: CryptoKey,
  payload: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const raw = fromBase64(payload);
    if (raw.length <= IV_BYTES) return null;
    return new Uint8Array(
      await subtle().decrypt(
        { name: 'AES-GCM', iv: raw.subarray(0, IV_BYTES) },
        key,
        raw.subarray(IV_BYTES),
      ),
    );
  } catch {
    return null;
  }
}

/** تشفير نص — الصورة النصية من `sealBytes`. */
export async function seal(key: CryptoKey, plaintext: string): Promise<string> {
  return sealBytes(key, encoder.encode(plaintext));
}

/** فكّ نص، و`null` عند أي فشل — كما في `unsealBytes` بلا فرق مُعلَن. */
export async function unseal(key: CryptoKey, payload: string): Promise<string | null> {
  const bytes = await unsealBytes(key, payload);
  return bytes ? decoder.decode(bytes) : null;
}
