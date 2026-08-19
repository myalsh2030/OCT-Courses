import { CircleAlert, CircleCheck, Download, LoaderCircle, Package, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SS01Row } from '../domain/ss01';
import { termLabel } from '../domain/term';
import { arabicDigits } from '../domain/vocab';
import {
  buildTermPackage,
  countDerivations,
  type BuildProgress,
  type PackageFile,
} from '../services/adminBundle';
import { loadTerms } from '../services/bundleSource';
import './admin.css';

/**
 * إنتاج حزمة الفصل المعمّاة وتنزيلها.
 *
 * البناء ليس لحظياً: اشتقاقٌ لكل شعبة مسندة بثلاثمئة ألف دورة PBKDF2 —
 * نصف دقيقة أو أكثر على تقرير كامل (٥٤٥ شعبة). فالزر يُقفل ويظهر شريط
 * تقدّم بعدد الاشتقاقات المنجزة وزمنها؛ الصمت دقيقةً يُقرأ عطلاً فيُعاد
 * النقر، والنقرة الثانية تعني بناءً ثانياً كاملاً.
 *
 * ولا يُنزَّل شيء قبل حارس الحرف العربي في `services/adminBundle.ts`:
 * حرفٌ عربي واحد في ملفٍ يُنشر يعني نصاً صريحاً تسرّب، والملف ذاهب إلى
 * مستودع عام.
 */

/**
 * ينزّل ملفاً باسمٍ مقترح. الرابط يُلحق بالوثيقة قبل النقر ويُبطَل عنوانه
 * بعد مهلة لا فور النقر: التنزيل يبدأ بعد انتهاء معالج الحدث، وإبطال
 * العنوان في اللحظة نفسها قد يُجهض ملفاً لم يُقرأ بعد.
 */
function download(file: PackageFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface AdminPackageProps {
  rows: SS01Row[];
  term: string;
}

interface Done {
  kind: 'ok' | 'error';
  text: string;
  /** الملفات المبنية — تبقى في الحالة ليُعاد تنزيلها بنقرة إن منعها المتصفح. */
  files: PackageFile[];
}

export function AdminPackage({ rows, term }: AdminPackageProps) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Done | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  // تقريرٌ جديد يُبطل نتيجة الحزمة السابقة، فلا تُقرأ على أنها نتيجته
  useEffect(() => {
    setResult(null);
    setProgress(null);
  }, [term, rows]);

  const derivations = countDerivations(rows);

  const generate = useCallback(async () => {
    setBusy(true);
    setResult(null);
    setElapsed(0);
    setProgress({ done: 0, total: derivations, percent: 0 });
    const startedAt = Date.now();
    timer.current = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);

    try {
      // المانيفست المنشور حالياً كي لا تُمحى الفصول الأخرى منه
      const published = await loadTerms();
      const outcome = await buildTermPackage(rows, {
        term,
        publishedTerms: published.ok ? published.terms : [],
        onProgress: setProgress,
      });

      if (!outcome.ok) {
        setResult({ kind: 'error', text: outcome.message, files: [] });
        return;
      }

      for (const file of outcome.files) {
        download(file);
        // فسحةٌ بين التنزيلين: المتصفح يبتلع الثاني إن تلاصقا
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const kb = Math.round(outcome.files[0].text.length / 1024);
      setResult({
        kind: 'ok',
        text:
          `حزمة ${termLabel(term)}: ${arabicDigits(outcome.entry.trainers)} مدرباً و` +
          `${arabicDigits(outcome.entry.sections)} شعبة مسندة، ${arabicDigits(kb)} ك.ب، ` +
          `في ${arabicDigits(Math.round(outcome.seconds))} ثانية. لا حرف عربي واحد في الملف.`,
        files: outcome.files,
      });
    } catch (error) {
      setResult({ kind: 'error', text: `تعذّر إنتاج الحزمة: ${String(error)}`, files: [] });
    } finally {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setBusy(false);
    }
  }, [derivations, rows, term]);

  const percent = progress?.percent ?? 0;

  return (
    <div className="package-box">
      <div className="package-icon">
        <Package size={28} aria-hidden />
      </div>
      <h2>إنتاج حزمة بيانات {termLabel(term)}</h2>

      <button
        type="button"
        className="btn primary large-action"
        disabled={busy || derivations === 0}
        onClick={generate}
        title={
          derivations === 0
            ? 'لا شعبة مسندة في التقرير المعروض — لا حزمة تُبنى'
            : 'بناء الحزمة المعمّاة وتنزيلها مع مانيفست الفصول'
        }
      >
        {busy ? (
          <>
            <LoaderCircle size={20} className="spin" aria-hidden />
            تُبنى الحزمة… {arabicDigits(percent)}٪
          </>
        ) : (
          <>
            <Package size={20} aria-hidden />
            إنتاج حزمة البيانات
          </>
        )}
      </button>

      {busy && progress && (
        <div className="package-progress">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="progress-meta">
            <span>
              {arabicDigits(progress.done)} من {arabicDigits(progress.total)} اشتقاق مفتاح
            </span>
            <span>مضى {arabicDigits(elapsed)} ثانية</span>
          </div>
        </div>
      )}

      <p className="package-note">
        يُنتج الزر ملفَّين: حزمة الفصل المعمّاة و<span className="ltr">terms.json</span> محدَّثاً.
        سلّمهما لمن ينشرهما في <span className="ltr">public/data</span> بالمستودع — لا يُنشر تقرير
        الشعب نصاً صريحاً أبداً.
      </p>

      <p className="package-note" style={{ fontSize: 13, color: '#155e59' }}>
        <ShieldCheck size={14} aria-hidden style={{ verticalAlign: -2 }} /> يبني المتصفح{' '}
        {arabicDigits(derivations)} مفتاحاً (PBKDF2 ٣١٠ ألف دورة لكل شعبة) — نصف دقيقة أو أكثر
        بحسب جهازك، فلا تغلق الصفحة. ولو منع المتصفح التنزيل التلقائي فالملفان يُنزَّلان بنقرة من
        الإشعار أدناه بلا إعادة بناء.
      </p>

      {result && (
        <div
          className={result.kind === 'ok' ? 'alert-banner success' : 'alert-banner danger'}
          role="status"
        >
          {result.kind === 'ok' ? (
            <CircleCheck size={20} aria-hidden />
          ) : (
            <CircleAlert size={20} aria-hidden />
          )}
          <div className="alert-content">
            <div className="alert-title">
              {result.kind === 'ok' ? 'بُنيت الحزمة وسُلّمت للتنزيل' : 'لم تُنزَّل الحزمة'}
            </div>
            <p>{result.text}</p>
            {result.kind === 'ok' && (
              <p style={{ marginTop: 4, fontSize: 13 }}>
                إن لم يظهر الملفان في مجلد التنزيلات فقد منع المتصفح تنزيلاً تلقائياً مزدوجاً —
                انقر اسم الملف لتنزيله:
              </p>
            )}
            {result.files.length > 0 && (
              <div className="row-actions" style={{ marginTop: 8, justifyContent: 'flex-start' }}>
                {result.files.map((file) => (
                  <button
                    key={file.name}
                    type="button"
                    className="btn"
                    onClick={() => download(file)}
                    title="إعادة تنزيل هذا الملف — إن منع المتصفح التنزيل التلقائي"
                  >
                    <Download size={14} aria-hidden />
                    <bdi className="file-name">{file.name}</bdi>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
