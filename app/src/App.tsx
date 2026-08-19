import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminPlaceholder } from './ui/AdminPlaceholder';
import { AppShell } from './ui/AppShell';
import { CourseView } from './ui/CourseView';
import { PrintAll } from './ui/PrintAll';
import { RequireSession } from './ui/RequireSession';
import { TrainerHome } from './ui/TrainerHome';
import { TrainerLogin } from './ui/TrainerLogin';

/**
 * التوجيه بالهاش (#/) كي يعمل التطبيق من أي استضافة ثابتة أو من الملف
 * مباشرة دون إعداد خادم لإعادة الكتابة.
 *
 * `/` دخول المدرب، وكل ما تحت `RequireSession` محميّ: لوحته ووثائق
 * مقرراته وطباعتها الجماعية. و`/admin` مسارٌ محجوز لشاشة الأدمن التي
 * لم تُبنَ بعد، وأي مسار مجهول يعود إلى الدخول.
 */
export default function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}

/**
 * شجرة المسارات وحدها بلا موجّه — كي تُختبر حماية المسارات تحت موجّه
 * ذاكرة دون أن يُعاد وصفها في الاختبار (فيُختبر وصفٌ آخر غير المشحون).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route index element={<TrainerLogin />} />
      <Route path="admin" element={<AdminPlaceholder />} />
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route path="home" element={<TrainerHome />} />
          <Route path="course/:id" element={<CourseView />} />
          <Route path="print-all" element={<PrintAll />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
