/**
 * مشغّل سكربتات TypeScript للمشروع.
 *
 *   node scripts/run-ts.mjs scripts/build-bundle.ts [وسائط…]
 *
 * لماذا لا `node scripts/x.ts` مباشرة: نزع الأنواع في Node يعمل، لكن
 * مُحلّل ESM لا يقبل الاستيراد بلا لاحقة — و`src/` كلها تستورد هكذا
 * (`from './vault'`). ولماذا لا `vite-node`: اعتمادٌ إضافي لا داعي له،
 * وvite نفسه مثبَّت ويوفّر `ssrLoadModule` وهو ما يفعله vite-node.
 */
import { resolve } from 'node:path';
import { createServer } from 'vite';

const entry = process.argv[2];
if (!entry) {
  console.error('الاستعمال: node scripts/run-ts.mjs <ملف.ts> [وسائط…]');
  process.exit(2);
}

// السكربت المُشغَّل يرى `process.argv` كما لو شُغّل مباشرة: وسائطه من
// الموضع الثاني، لا يسبقها اسم هذا المشغّل.
process.argv = [process.argv[0], resolve(entry), ...process.argv.slice(3)];

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  await server.ssrLoadModule(entry.startsWith('/') ? entry : `/${entry}`);
} finally {
  await server.close();
}
