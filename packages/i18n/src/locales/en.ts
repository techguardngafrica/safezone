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
  'auth.phone.help': 'We will send a 6-digit code to this number by SMS.',
  'auth.phone.invalid': 'Enter a valid Nigerian phone number.',
  'auth.sendCode': 'Send code',
  'auth.otp.label': '6-digit code',
  'auth.otp.changeNumber': 'Use a different number',
  'auth.otp.resendIn': 'You can ask for a new code in {seconds}s',
  'auth.verify': 'Verify and sign in',
  'auth.restoring': 'Checking your session…',
  'auth.mfa.title': 'Two-step verification',
  'auth.mfa.prompt': 'Enter the 6-digit code from your authenticator app.',
  'auth.mfa.useRecovery': 'Use a recovery code instead',
  'auth.mfa.useCode': 'Use an authenticator code instead',
  'auth.mfa.recoveryLabel': 'Recovery code',
  'auth.mfa.verify': 'Verify',
  'auth.mfa.enrolTitle': 'Set up two-step verification',
  'auth.mfa.enrolBody':
    'Staff accounts must use an authenticator app. Add this key to Google Authenticator, Microsoft Authenticator or a similar app, then enter the code it shows.',
  'auth.mfa.secretLabel': 'Setup key',
  'auth.mfa.openApp': 'Open in authenticator app',
  'auth.mfa.confirm': 'Confirm and continue',
  'auth.mfa.recoveryTitle': 'Save your recovery codes',
  'auth.mfa.recoveryBody':
    'Each code works once if you lose your phone. Keep them somewhere safe. They will not be shown again.',
  'auth.mfa.recoverySaved': 'I have saved my codes',
  'auth.error.OTP_INVALID': 'The code is wrong or has expired.',
  'auth.error.RATE_LIMITED': 'Too many attempts. Wait a few minutes and try again.',
  'auth.error.OTP_DELIVERY_FAILED': 'We could not send the code. Try again shortly.',
  'auth.error.MFA_CODE_INVALID': 'The code is wrong or was already used.',
  'auth.error.ACCOUNT_UNAVAILABLE': 'This account cannot sign in. Contact support.',
  'auth.error.VALIDATION_FAILED': 'Check the details and try again.',
  'auth.error.NETWORK_ERROR': 'No connection. Check your internet and try again.',
  'auth.error.UNKNOWN': 'Something went wrong. Please try again.',

  'home.signedInAs': 'Signed in as {name}',
  'home.memberships.title': 'Your estates',
  'home.memberships.empty': 'You are not a member of any estate yet.',
  'home.memberships.roles': 'Roles: {roles}',
  'home.memberships.error': 'We could not load your estates.',
  'admin.home.noAccess':
    'This account has no Techguard platform role. Ask a Super Admin for access.',
  'admin.home.platformLabel': 'Techguard Platform',
  'public.account.title': 'Your account',
  'public.account.signInIntro': 'Sign in to register your estate or follow your application.',

  'notifications.account.security_alert.title': 'Security alert',
  'notifications.account.security_alert.body':
    'We signed out one of your devices because your sign-in was used from somewhere unexpected. If this was not you, contact support.',
  'notifications.account.security_alert.sms':
    'Safezone: we signed out a device on your account after unusual activity. If this was not you, contact support.',

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
