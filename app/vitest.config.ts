import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // نحتاج تحويل JSX لاختبار مطابقة المكوّنات للنموذج المرجعي
  plugins: [react()],
  test: {
    environment: 'node',
    // fake-indexeddb يوفّر IndexedDB حقيقياً في Node، فنختبر التنفيذ نفسه لا محاكاة له.
    setupFiles: ['./src/test/setup.ts'],
  },
});
