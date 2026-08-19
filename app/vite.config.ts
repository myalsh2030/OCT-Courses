import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// النشر على GitHub Pages تحت مسار المستودع، فالأصول تُطلب من
// /MaintCourses/… ؛ والتوجيه بالهاش (HashRouter) فلا يحتاج إعداداً إضافياً.
// التطوير المحلي يبقى على الجذر.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/MaintCourses/' : '/',
  plugins: [react()],
}))
