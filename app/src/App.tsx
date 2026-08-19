import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './ui/AppShell';
import { CourseIndex } from './ui/CourseIndex';
import { CourseView } from './ui/CourseView';
import { PrintAll } from './ui/PrintAll';

/**
 * التوجيه بالهاش (#/) كي يعمل التطبيق من أي استضافة ثابتة أو من الملف
 * مباشرة دون إعداد خادم لإعادة الكتابة.
 */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<CourseIndex />} />
          <Route path="course/:id" element={<CourseView />} />
          <Route path="print-all" element={<PrintAll />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
