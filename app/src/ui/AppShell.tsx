import { GraduationCap, House } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import './shell.css';

/**
 * قشرة التطبيق: شريط علوي ثابت و<main> هو حاوية التمرير على الشاشات
 * الكبيرة (الجوال على تمرير الصفحة الطبيعي)، وكلاهما يُفكّ عند الطباعة.
 */
export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();

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
          ملف المدرب وتوصيف المقرر — تقنية الصيانة الميكانيكية
        </span>
        <span className="grow" />
        <Link to="/" title="فهرس المقررات">
          <House size={18} aria-hidden />
          الفهرس
        </Link>
      </div>
      <main ref={mainRef}>
        <Outlet />
      </main>
    </div>
  );
}
