// English messages: every user-visible string lives here and goes through t().
export const en = {
  'app.name': 'wiremock-ui',
  'hazard.label': 'Test environment — mocks only, never real data',

  'nav.label': 'Main navigation',
  'nav.mocks': 'Mocks',
  'nav.requests': 'Request log',
  'nav.catalog': 'Catalog',
  'nav.users': 'Users',
  'nav.audit': 'Audit',
  'nav.import': 'Import',

  'shell.skipToContent': 'Skip to content',
  'shell.openNav': 'Open navigation',
  'common.close': 'Close',

  'theme.label': 'Theme',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',

  'role.viewer': 'Viewer',
  'role.tester': 'Tester',
  'role.developer': 'Developer',
  'role.admin': 'Admin',
  'user.signedInAs': 'Signed in as {name}',

  'login.title': 'Sign in',
  'login.subtitle': 'Use the account your admin created for you.',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.wrongCredentials': 'Wrong username or password',
  'login.rateLimited': 'Too many sign-in attempts from this network. Try again in 15 minutes.',

  'preview.title': 'Shell preview',
  'preview.body': 'The pages arrive in the next tasks. Use the navigation, the language and the theme toggles to check the shell.',
} as const
