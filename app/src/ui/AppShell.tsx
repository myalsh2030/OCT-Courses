import { GraduationCap, LayoutDashboard, LogOut } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { termLabel } from '../domain/term';
import { clearSession } from '../services/session';
import { useMaybeSession } from './sessionContext';
import './shell.css';
import './trainer.css';

/**
 * قشرة التطبيق: شريط علوي ثابت و<main> هو حاوية التمرير على الشاشات
 * الكبيرة (الجوال على تمرير الصفحة الطبيعي)، وكلاهما يُفكّ عند الطباعة.
 *
 * الشريط يحمل هوية الفصل الجاري وزر الخروج؛ والخروج يمسح الجلسة من
 * `sessionStorage` ويعود بالمدرب إلى شاشة الدخول.
 */
export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const session = useMaybeSession();

  // ScrollToTop عند تغيّر المسار — التمرير في <main> لا في النافذة
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="shell">
      <div className="topbar">
        <span className="title">
          <GraduationCap size={22} aria-hidden />
          ملف المدرب وتوصيف المقرر
        </span>
        {session && (
          <span className="topbar-badge" title="الفصل التدريبي المعروض">
            {termLabel(session.term)}
          </span>
        )}
        <span className="grow" />
        {session && (
          <>
            <Link to="/home" title="العودة إلى لوحة مقرراتي">
              <LayoutDashboard size={18} aria-hidden />
              لوحتي
            </Link>
            <button
              type="button"
              className="topbar-exit"
              title="تسجيل الخروج ومسح الجلسة من هذا المتصفح"
              onClick={() => {
                clearSession();
                navigate('/', { replace: true });
              }}
            >
              <LogOut size={18} aria-hidden />
              خروج
            </button>
          </>
        )}
      </div>
      <main ref={mainRef}>
        <Outlet />
      </main>
    </div>
  );
}
