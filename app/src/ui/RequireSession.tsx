import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { readSession } from '../services/session';
import { SessionContext } from './sessionContext';

/**
 * بوابة المسارات المحميّة: بلا جلسة يُعاد الزائر إلى شاشة الدخول.
 *
 * الحماية هنا حماية **تجربة** لا حماية بيانات: بيانات المدرب معمّاة في
 * الملف المنشور نفسه، فلا يكشفها مسارٌ يُفتح مباشرة. الغرض ألّا يرى من
 * فتح `#/home` أو `#/course/…` بلا دخول شاشةً فارغة بلا سبب مفهوم.
 *
 * المسار المطلوب يُمرَّر في `state` كي يعود إليه بعد الدخول من أراده.
 */
export function RequireSession() {
  const location = useLocation();
  const session = readSession();

  if (!session) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return (
    <SessionContext.Provider value={session}>
      <Outlet />
    </SessionContext.Provider>
  );
}
