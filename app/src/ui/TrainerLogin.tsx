import {
  CircleAlert,
  LoaderCircle,
  LogIn,
  Settings,
  UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { VaultBundle } from '../domain/bundle';
import { termLabel } from '../domain/term';
import { loadBundle, loadTerms } from '../services/bundleSource';
import { getCourseService } from '../services/courseService';
import { readSession, saveSession, signIn } from '../services/session';
import './trainer.css';

/**
 * شاشة دخول المدرب — حقلان لا أكثر: رقمه الوظيفي ورقمٌ مرجعي لإحدى شعبه.
 *
 * لا كلمة مرور ولا بريد: التحقق يجري على حزمة الفصل المعمّاة نفسها، فمن
 * فُتح سجله فقد أثبت أنه صاحبه. واشتقاق المفتاح (PBKDF2 ٣١٠ ألف دورة)
 * يستغرق نحو ثانيتين، فالزر يُقفل ويظهر مؤشر انتظار صريح — الصمت ثانيتين
 * يُقرأ عطلاً.
 */
export function TrainerLogin() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [loadError, setLoadError] = useState('');
  const [trainerNo, setTrainerNo] = useState('');
  const [refNo, setRefNo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** الحزمة تُجلب في الخلفية فور معرفة الفصل، فلا ينتظرها المدرب مرتين. */
  const bundleRef = useRef<Promise<VaultBundle | string> | null>(null);

  useEffect(() => {
    if (readSession()) {
      navigate('/home', { replace: true });
      return;
    }
    let alive = true;
    (async () => {
      const terms = await loadTerms();
      if (!alive) return;
      if (!terms.ok) {
        setLoadError(terms.message);
        return;
      }
      const latest = terms.terms[0].term;
      setTerm(latest);
      bundleRef.current = loadBundle(latest).then((r) => (r.ok ? r.bundle : r.message));
    })();
    return () => {
      alive = false;
    };
  }, [navigate]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy || !term) return;
      setError('');
      setBusy(true);
      try {
        const bundle = await (bundleRef.current ??= loadBundle(term).then((r) =>
          r.ok ? r.bundle : r.message,
        ));
        if (typeof bundle === 'string') {
          setError(bundle);
          return;
        }
        const result = await signIn(bundle, term, trainerNo, refNo);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        // روابط مقرراته تُكتب قبل الانتقال، فتجد اللوحة بياناتها جاهزة
        const service = await getCourseService();
        await service.applyTrainerRecord(result.session.record);
        saveSession(result.session);
        navigate('/home', { replace: true });
      } catch (e) {
        setError(`تعذّر إتمام الدخول: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, navigate, refNo, term, trainerNo],
  );

  return (
    <div className="login-page">
      <header className="login-topbar">
        <div className="login-brand" aria-hidden />
        <Link
          to="/admin"
          className="btn"
          style={{ fontSize: 13, padding: '4px 12px' }}
          title="الانتقال إلى لوحة إدارة النظام"
        >
          <Settings size={14} aria-hidden />
          <span>بوابة المشرف والأدمن</span>
        </Link>
      </header>

      <main className="login-content">
        <div className="login-card">
          <div className="login-header">
            <div className="avatar">
              <UserRound size={24} aria-hidden />
            </div>
            <div className="login-college">الكلية التقنية بعنيزة</div>
            <h1>ملف المدرب وتوصيف المقرر</h1>
            {term && <p>{termLabel(term)}</p>}
          </div>

          <div className="login-body">

            {loadError && (
              <div className="alert-banner danger compact" role="alert">
                <CircleAlert size={18} aria-hidden />
                <div className="alert-content">
                  <strong>بيانات الفصل غير متاحة:</strong> {loadError}
                </div>
              </div>
            )}

            {error && (
              <div className="alert-banner danger compact" role="alert">
                <CircleAlert size={18} aria-hidden />
                <div className="alert-content">
                  <strong>تعذّر الدخول:</strong> {error}
                </div>
              </div>
            )}

            <form onSubmit={submit}>
              <div className="form-group">
                <label className="form-label" htmlFor="trainerNoInput">
                  ١) رقم المدرب الوظيفي <span style={{ color: '#c00000' }}>*</span>
                </label>
                <input
                  id="trainerNoInput"
                  className="form-input ltr big"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="مثال: 0013270 أو 13270"
                  value={trainerNo}
                  onChange={(e) => setTrainerNo(e.target.value)}
                  required
                  disabled={busy}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="crnInput">
                  ٢) الرقم المرجعي لإحدى شعبك <span style={{ color: '#c00000' }}>*</span>
                </label>
                <input
                  id="crnInput"
                  className="form-input ltr big"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="مثال: 10630"
                  value={refNo}
                  onChange={(e) => setRefNo(e.target.value)}
                  required
                  disabled={busy}
                />
              </div>

              <button
                type="submit"
                className="btn primary wide"
                disabled={busy || !term}
                title={
                  term
                    ? 'التحقق يفكّ سجلك من حزمة الفصل المعمّاة على جهازك'
                    : 'يُنتظر تحميل بيانات الفصل'
                }
              >
                {busy ? (
                  <>
                    <LoaderCircle size={18} className="spin" aria-hidden />
                    يتحقق… (اشتقاق مفتاح ملفك يستغرق نحو ثانيتين)
                  </>
                ) : (
                  <>
                    <LogIn size={18} aria-hidden />
                    دخول إلى لوحة المدرب
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
