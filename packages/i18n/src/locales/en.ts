/** English (source) strings. Other locales must have the same keys. */
export const en = {
  'app.name': 'Safezone',
  'app.tagline': 'One platform. Multiple estates. Connected communities. Safer living.',

  'auth.phone.label': 'Phone number',
  'auth.phone.placeholder': '0803 123 4567',
  'auth.otp.title': 'Enter the 6-digit code',
  'auth.otp.sent': 'We sent a code to {phone}',
  'auth.otp.resend': 'Resend code',
  'auth.signIn': 'Sign in',
  'auth.signOut': 'Sign out',

  'common.continue': 'Continue',
  'common.cancel': 'Cancel',
  'common.retry': 'Try again',
  'common.offline': 'You are offline. Some actions will be sent when you reconnect.',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong. Please try again.',
  'common.sponsored': 'Sponsored',

  'sos.button': 'SOS',
  'sos.hold': 'Hold to send an emergency alert',
  'sos.sent': 'Alert sent. Security has been notified.',
  'sos.cancel': 'Cancel alert ({seconds}s)',
  'sos.smsFallback': 'No internet. Send SOS by SMS instead?',

  'gate.allow': 'ALLOW',
  'gate.check': 'CHECK',
  'gate.deny': 'DENY',
  'gate.scan': 'Scan pass',
  'gate.enterPin': 'Enter PIN',
  'gate.walkIn': 'Walk-in visitor',

  'resident.home.title': 'Home',
  'management.home.title': 'Estate overview',
  'security.home.title': 'Gate',
  'admin.home.title': 'Platform overview',
  'public.home.headline': 'Run your estate safely, all in one place',
  'public.home.cta': 'Register your estate — it’s free',
  'public.pass.title': 'Your visitor pass',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
