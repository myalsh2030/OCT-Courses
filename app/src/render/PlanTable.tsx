import { Plus, X } from 'lucide-react';
import { Fragment } from 'react';
import type { PlanWeek } from '../domain/course.schema';
import { FORM_TEMPLATE as T } from '../domain/template';
import { ASSESSMENT_TOOLS, STRATEGY_OPTIONS } from '../domain/vocab';
import { useDocumentEdit, type DocumentEditApi } from '../ui/EditContext';

/**
 * يبني جدول الخطة من كتل ممتدة إلى صفوف <tr>.
 *
 * كل عمود قائمة خلايا ذات امتداد؛ نمرّ على الصفوف واحداً واحداً ونضع
 * الخلية عند أول صف يبدأ فيه امتدادها. المخطط يضمن مسبقاً أن الامتدادات
 * تغطي الصفوف تماماً، فلا حاجة لمعالجة الفجوات هنا.
 *
 * عند حضور سياق التحرير تتحول خلايا الأهداف والاستراتيجية والأداة إلى
 * عناصر إدخال؛ أسابيع الاختبار النهائي تبقى للقراءة لأنها تُستبدل كاملةً
 * عند تغيير طول الفصل فأي تحرير فيها سيضيع.
 */
function cellStarts<C extends { span: number }>(cells: C[]): Map<number, { cell: C; index: number }> {
  const map = new Map<number, { cell: C; index: number }>();
  let row = 0;
  cells.forEach((cell, index) => {
    map.set(row, { cell, index });
    row += cell.span;
  });
  return map;
}

function EditableChoice({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  const known = value === '' || options.includes(value);
  return (
    <select className="cell-edit" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {!known && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function WeekRows({
  week,
  weekIndex,
  edit,
}: {
  week: PlanWeek;
  weekIndex: number;
  edit: DocumentEditApi | null;
}) {
  const cols = {
    week: cellStarts(week.week),
    units: cellStarts(week.units),
    hours: cellStarts(week.hours),
    objectives: cellStarts(week.objectives),
    strategies: cellStarts(week.strategies),
    tools: cellStarts(week.tools),
    grades: cellStarts(week.grades),
  };
  // النهائي يُستبدل بتغيير طول الفصل — تحريره وهْمٌ يضيع، فيُقفل. يشمل
  // ذلك أسبوع ١٦ حين يحمل صف الاختبار العملي المضمَّن (الطولان ١٧ و١٨).
  const editable =
    edit && !week.units.some((u) => u.text.startsWith('اختبار نهائي')) ? edit : null;
  // صفوف المحتوى مرقّمة؛ صفوف الاختبارات بلا ترقيم وتبقى مقفلة
  const contentRows = week.units.filter((u) => u.code !== undefined).length;

  return (
    <>
      {Array.from({ length: week.rowCount }, (_, row) => {
        const wk = cols.week.get(row);
        const unit = cols.units.get(row);
        const hours = cols.hours.get(row);
        const obj = cols.objectives.get(row);
        const strategy = cols.strategies.get(row);
        const tool = cols.tools.get(row);
        const grade = cols.grades.get(row);

        return (
          <tr key={`${weekIndex}-${row}`}>
            {wk && (
              <td className="wk" rowSpan={wk.cell.span}>
                {wk.cell.text}
                {editable && (
                  <button
                    type="button"
                    className="row-btn add"
                    title="إضافة موضوع جديد لهذا الأسبوع"
                    onClick={() => editable.addUnitRow(weekIndex)}
                  >
                    <Plus size={13} aria-hidden />
                  </button>
                )}
              </td>
            )}
            {unit &&
              (editable && unit.cell.code !== undefined ? (
                <td className="unit unit-editing" rowSpan={unit.cell.span}>
                  <span className="num">{unit.cell.code}</span>
                  <textarea
                    className="cell-edit topic-edit"
                    value={unit.cell.text}
                    rows={Math.max(1, Math.ceil(unit.cell.text.length / 34))}
                    onChange={(e) => editable.setUnitTopic(weekIndex, row, e.target.value)}
                  />
                  <button
                    type="button"
                    className="row-btn del"
                    title={
                      contentRows <= 1
                        ? 'لا يمكن حذف آخر موضوع في الأسبوع'
                        : 'حذف هذا الموضوع من الأسبوع'
                    }
                    disabled={contentRows <= 1}
                    onClick={() => editable.removeUnitRow(weekIndex, row)}
                  >
                    <X size={13} aria-hidden />
                  </button>
                </td>
              ) : (
                <td className={unit.cell.code ? 'unit' : 'mid'} rowSpan={unit.cell.span}>
                  {unit.cell.code && <span className="num">{unit.cell.code}</span>}
                  {unit.cell.code ? ` ${unit.cell.text}` : unit.cell.text}
                </td>
              ))}
            {hours && (
              <td className="hrs" rowSpan={hours.cell.span}>
                {hours.cell.value ?? ''}
              </td>
            )}
            {obj &&
              (editable ? (
                <td className="obj" rowSpan={obj.cell.span}>
                  <textarea
                    className="cell-edit obj-edit"
                    value={obj.cell.lines.join('\n')}
                    rows={Math.max(obj.cell.lines.length, 2)}
                    onChange={(e) => editable.setObjectives(weekIndex, e.target.value)}
                  />
                </td>
              ) : (
                <td className={obj.cell.lines.length > 1 ? 'obj' : 'obj mid'} rowSpan={obj.cell.span}>
                  {obj.cell.lines.map((line, i) => (
                    <Fragment key={line}>
                      {i > 0 && <br />}
                      {line}
                    </Fragment>
                  ))}
                </td>
              ))}
            {strategy && (
              <td className="st" rowSpan={strategy.cell.span}>
                {editable ? (
                  <EditableChoice
                    value={strategy.cell.text}
                    options={STRATEGY_OPTIONS}
                    onChange={(v) => editable.setStrategy(weekIndex, strategy.index, v)}
                  />
                ) : (
                  strategy.cell.text
                )}
              </td>
            )}
            {tool && (
              <td className="tool" rowSpan={tool.cell.span}>
                {editable ? (
                  <EditableChoice
                    value={tool.cell.text}
                    options={ASSESSMENT_TOOLS}
                    onChange={(v) => editable.setTool(weekIndex, tool.index, v)}
                  />
                ) : (
                  tool.cell.text
                )}
              </td>
            )}
            {grade && (
              <td className="gr" rowSpan={grade.cell.span}>
                {grade.cell.value ?? ''}
              </td>
            )}
          </tr>
        );
      })}
    </>
  );
}

export function PlanTable({ weeks, offset = 0 }: { weeks: PlanWeek[]; offset?: number }) {
  const edit = useDocumentEdit();
  const c = T.planColumns;
  return (
    <table className="plan">
      <colgroup>
        <col style={{ width: '6.5%' }} />
        <col style={{ width: '37%' }} />
        <col style={{ width: '5.5%' }} />
        <col style={{ width: '24%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '8%' }} />
        <col style={{ width: '8%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>{c.week}</th>
          <th>
            {c.units}
            <span className="sub">{c.unitsSub}</span>
          </th>
          <th>{c.hours}</th>
          <th>
            {c.objectives}
            <span className="sub">{c.objectivesSub}</span>
          </th>
          <th>{c.strategy}</th>
          <th>{c.tool}</th>
          <th>{c.grade}</th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, i) => (
          <WeekRows key={offset + i} week={week} weekIndex={offset + i} edit={edit} />
        ))}
      </tbody>
    </table>
  );
}
