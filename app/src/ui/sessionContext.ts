import { createContext, useContext } from 'react';
import type { TrainerSession } from '../services/session';

/**
 * جلسة المدرب الجارية، تُوفَّرها بوابة المسارات (`RequireSession`) لكل ما
 * تحتها. أي شاشة محميّة تجدها موجودة يقيناً — البوابة لا تعرض أبناءها
 * قبل التحقق منها.
 */
export const SessionContext = createContext<TrainerSession | null>(null);

/** الجلسة داخل المسارات المحميّة (غيابها خطأ برمجي لا حالة مستخدم). */
export function useSession(): TrainerSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('استُعملت الجلسة خارج المسارات المحميّة.');
  return session;
}

/** الجلسة إن وُجدت — لمن يعمل داخل المسارات المحميّة وخارجها. */
export function useMaybeSession(): TrainerSession | null {
  return useContext(SessionContext);
}
