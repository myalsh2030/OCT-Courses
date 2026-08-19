/**
 * يولّد ملفات المقررات التسعة من الخطة الرسمية إلى src/data/courses/.
 *
 * التشغيل:  npx vite-node scripts/generate-courses.ts
 *
 * هذه هي «النسخة الأصلية» لكل مقرر. تعديلات المدربين لا تلمس هذه الملفات —
 * تُخزَّن نسخاً جديدة عبر طبقة التخزين وتبقى هذه مرجعاً للمقارنة والرجوع.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCourse } from '../src/domain/course.schema';
import { generatableCourses, generateCourse } from '../src/domain/generator';

const OUT_DIR = resolve(__dirname, '../src/data/courses');
const generatedAt = new Date().toISOString().slice(0, 10);

mkdirSync(OUT_DIR, { recursive: true });

let failed = 0;
for (const code of generatableCourses()) {
  const course = generateCourse(code, { semesterLength: 19, generatedAt });
  const check = parseCourse(course);
  if (!check.ok) {
    failed += 1;
    console.error(`✗ ${code}:`);
    for (const issue of check.issues) console.error(`   ${issue.path}: ${issue.message}`);
    continue;
  }
  const file = resolve(OUT_DIR, `${course.id}.json`);
  writeFileSync(file, JSON.stringify(course, null, 1) + '\n', 'utf8');
  // عدد الأسابيع المغطاة = خلايا أسماء الأسابيع (النهائي المدموج يغطي أسبوعين)
  const weeks = course.plan.reduce((s, w) => s + w.week.length, 0);
  console.log(
    `✓ ${course.id}  ${course.name}  (${weeks} أسبوعاً، ${course.declaredTotalHours} ساعة)`,
  );
}

if (failed > 0) {
  console.error(`\n${failed} مقرر فشل التحقق — لم يُكتب.`);
  process.exit(1);
}
console.log('\nاكتمل التوليد.');
