import { ArrowLeft, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import './trainer.css';

/**
 * بوابة الأدمن — مسارٌ محجوز لم يُبنَ بعد.
 *
 * وُضع فارغاً عمداً: بناء صفحة الأدمن (رفع تقرير رايات، الفروق، إنتاج
 * الحزمة) عملٌ مستقل. والمسار موجود كي لا يقع من فتحه على شاشة بيضاء.
 */
export function AdminPlaceholder() {
  return (
    <div className="login-page">
      <main className="login-content">
        <div className="login-card">
          <div className="login-header">
            <div className="avatar">
              <Settings size={24} aria-hidden />
            </div>
            <h1>بوابة المشرف والأدمن</h1>
            <p>قيد الإنشاء</p>
          </div>
          <div className="login-body">
            <p style={{ lineHeight: 1.8 }}>
              رفع تقرير رايات وعرض فروقه وإنتاج حزمة الفصل المعمّاة — كلها أدوات الأدمن، ولم
              تُبنَ شاشتها بعد. حزمة الفصل تُنتَج حالياً بسكربت البناء في المستودع.
            </p>
            <Link className="btn primary wide" to="/" style={{ marginTop: 18 }}>
              <ArrowLeft size={16} aria-hidden />
              العودة إلى دخول المدرب
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
