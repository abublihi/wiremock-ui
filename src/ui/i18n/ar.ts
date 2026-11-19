import type { MessageKey } from './index'

// Arabic messages: exactly the keys of en.ts (enforced by tests/ui/i18n.test.ts).
export const ar: Record<MessageKey, string> = {
  'app.name': 'wiremock-ui',
  'hazard.label': 'بيئة اختبار — بيانات وهمية فقط، وليست بيانات حقيقية أبدًا',

  'nav.label': 'التنقل الرئيسي',
  'nav.mocks': 'الاستجابات الوهمية',
  'nav.requests': 'سجل الطلبات',
  'nav.catalog': 'الفهرس',
  'nav.users': 'المستخدمون',
  'nav.audit': 'سجل التدقيق',
  'nav.import': 'الاستيراد',

  'shell.skipToContent': 'انتقل إلى المحتوى',
  'shell.openNav': 'افتح قائمة التنقل',
  'common.close': 'إغلاق',

  'locale.change': 'تغيير اللغة',
  'locale.en': 'English',
  'locale.ar': 'العربية',

  'theme.label': 'المظهر',
  'theme.light': 'فاتح',
  'theme.dark': 'داكن',
  'theme.system': 'حسب النظام',

  'role.viewer': 'مُشاهِد',
  'role.tester': 'مختبِر',
  'role.developer': 'مطوِّر',
  'role.admin': 'مسؤول',
  'user.signedInAs': 'تم تسجيل الدخول باسم {name}',

  'login.title': 'تسجيل الدخول',
  'login.subtitle': 'استخدم الحساب الذي أنشأه لك المسؤول.',
  'login.username': 'اسم المستخدم',
  'login.password': 'كلمة المرور',
  'login.submit': 'تسجيل الدخول',
  'login.submitting': 'جارٍ تسجيل الدخول…',
  'login.wrongCredentials': 'اسم المستخدم أو كلمة المرور غير صحيحة',
  'login.rateLimited': 'محاولات تسجيل دخول كثيرة جدًا من هذه الشبكة. حاول مرة أخرى بعد 15 دقيقة.',

  'preview.title': 'معاينة الواجهة',
  'preview.body': 'تصل الصفحات في المهام التالية. استخدم التنقل ومبدّلَي اللغة والمظهر لتفحّص الواجهة.',
}
