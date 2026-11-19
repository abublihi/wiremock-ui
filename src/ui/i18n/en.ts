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

  'user.signedInAs': 'Signed in as {name}',

  'login.title': 'Sign in',
  'login.subtitle': 'Use the account your admin created for you.',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.wrongCredentials': 'Wrong username or password',
  'login.rateLimited': 'Too many sign-in attempts from this network. Try again in 15 minutes.',


  'error.generic': 'Something went wrong. Try again.',
  'common.cancel': 'Cancel',

  'user.menu': 'Account menu',
  'user.changePassword': 'Change password',
  'user.signOut': 'Sign out',
  'user.signOutFailed': 'Could not sign out. Try again.',

  'password.title': 'Change password',
  'password.description': 'Your other signed-in devices will be signed out.',
  'password.current': 'Current password',
  'password.next': 'New password',
  'password.hint': 'Between 8 and 72 characters.',
  'password.length': 'Use between 8 and 72 characters.',
  'password.required': 'Enter your current password.',
  'password.submit': 'Change password',
  'password.submitting': 'Changing…',
  'password.changed': 'Password changed',

  'mocks.placeholderTitle': 'Mocks',
  'mocks.placeholderBody': 'Mocks arrive in the next task',
} as const
