import { createContext, useContext } from 'react';
import type { ContactBlock, TrainerProfile } from '../domain/department';

/**
 * سياق التحرير داخل الوثيقة.
 *
 * غيابه (null) يعني عرضاً صرفاً — وهو الوضع الافتراضي الذي تُبنى عليه
 * اختبارات مطابقة الوثيقة الورقية، فلا يتغير الإخراج قيد شعرة.
 * حضوره يحوّل خلايا محددة (الأهداف نصاً، الاستراتيجية والأداة قائمتين،
 * والمراجع والمتطلبات وبيانات المدرب حقولاً) إلى عناصر إدخال. تعديلات
 * المقرر تُكتب في مسودّته، وتعديلات المدرب ورئيس القسم في ملفيهما
 * المستقلين فتسري على كل المقررات.
 */
export interface DocumentEditApi {
  setObjectives(weekIndex: number, text: string): void;
  setStrategy(weekIndex: number, cellIndex: number, value: string): void;
  setTool(weekIndex: number, cellIndex: number, value: string): void;

  /** مواضيع الأسبوع: تعديل نص صف، إضافة صف، حذف صف (صفوف الاختبارات مقفلة). */
  setUnitTopic(weekIndex: number, rowIndex: number, text: string): void;
  addUnitRow(weekIndex: number): void;
  removeUnitRow(weekIndex: number, rowIndex: number): void;

  setReference(
    rowIndex: number,
    field: 'main' | 'site' | 'platform' | 'mainUrl' | 'siteUrl' | 'platformUrl',
    value: string,
  ): void;
  addReference(): void;
  removeReference(rowIndex: number): void;

  /** متطلبات التدريب — سطر لكل بند في التجهيزات والسلامة. */
  setResources(text: string): void;
  setEquipment(text: string): void;
  setSafety(text: string): void;

  /** يعدّل ملف المدرب (يُحفظ مستقلاً عن مسودّة المقرر). */
  updateTrainer(mutate: (trainer: TrainerProfile) => void): void;
  /** يعدّل بيانات رئيس القسم (إعداد عام واحد). */
  updateHead(mutate: (head: ContactBlock) => void): void;
}

export const EditContext = createContext<DocumentEditApi | null>(null);

export function useDocumentEdit(): DocumentEditApi | null {
  return useContext(EditContext);
}
