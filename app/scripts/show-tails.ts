import { generateCourse } from '../src/domain/generator';
import { adaptCourseLength } from '../src/domain/planLength';

for (const len of [17, 18, 19] as const) {
  const c = adaptCourseLength(generateCourse('MMIN 141'), len);
  console.log('=== طول', len, '===');
  for (const w of c.plan.slice(15)) {
    console.log(' ', w.week.map((x) => x.text).join(' + '), '|', w.units[0].text, '| درجة', w.grades[0].value);
  }
}
