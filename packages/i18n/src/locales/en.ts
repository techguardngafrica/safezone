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

  'notifications.onboarding.application_received.title': 'Application received',
  'notifications.onboarding.application_received.body':
    'We received your application for {estateName}. Techguard will review it within 2 working days.',
  'notifications.onboarding.application_info_requested.title': 'More information needed',
  'notifications.onboarding.application_info_requested.body':
    'Techguard needs more information about {estateName}: {reason}',
  'notifications.onboarding.application_approved.title': 'Your estate is approved',
  'notifications.onboarding.application_approved.body':
    '{estateName} is approved. Sign in to the Safezone management app to finish setting it up.',
  'notifications.onboarding.application_rejected.title': 'Application not approved',
  'notifications.onboarding.application_rejected.body':
    'We could not approve {estateName}: {reason}',
  'notifications.onboarding.invitation.sms':
    'Safezone: you are invited to manage {estateName}. Accept within 7 days: {link}',
  'notifications.onboarding.invitation.email_subject':
    'You are invited to manage {estateName} on Safezone',
  'notifications.onboarding.invitation.email_body':
    'Hello,\n\nTechguard has set up {estateName} on Safezone and invited you to manage it as {role}.\n\nOpen this link within 7 days and sign in with {phone} to accept:\n{link}\n\nIf you did not expect this invitation, you can ignore this email.\n\nSafezone by Techguard',

  'notifications.occupancy.join_request_approved.title': 'Welcome to {estateName}',
  'notifications.occupancy.join_request_approved.body':
    'Your request to join {unitCode} was approved. You can now invite visitors and use SOS.',
  'notifications.occupancy.join_request_rejected.title': 'Join request not approved',
  'notifications.occupancy.join_request_rejected.body':
    'Your request to join {unitCode} in {estateName} was not approved: {reason}',
  'notifications.occupancy.join_request_waiting.title': 'Someone wants to join your household',
  'notifications.occupancy.join_request_waiting.body':
    '{name} asked to join your household at {unitCode}. Open Safezone to approve or decline.',
  'notifications.occupancy.added_to_household.title': 'You were added to a household',
  'notifications.occupancy.added_to_household.body':
    'You were added to the household at {unitCode} in {estateName}. Sign in to Safezone with this number.',

  'notifications.visitor.walkin_request.title': 'Visitor at the gate',
  'notifications.visitor.walkin_request.body':
    '{name} is at {gate} asking to visit {unitCode}. Open Safezone to let them in or decline.',
  'notifications.visitor.arrived.title': 'Your visitor has arrived',
  'notifications.visitor.arrived.body': '{name} entered through {gate}.',
  'notifications.visitor.pass.sms':
    'Safezone: {host} invited you to {estateName}. Your gate PIN is {pin}. Pass: {link}',
  'notifications.visitor.pass.email_subject': 'Your visitor pass for {estateName}',
  'notifications.visitor.pass.email_body':
    'You are invited to {estateName}. Show this pass at the gate or give the PIN {pin}.\n\n{link}\n\nSafezone by Techguard',

  'notifications.emergency.sos.title': '{label}SOS: {category}',
  'notifications.emergency.sos.body': '{label}Emergency at {place}. Open Safezone to respond.',
  'notifications.emergency.sos.sms':
    'Safezone {label}SOS: {category} at {place}. Respond in the Security app.',
  'notifications.emergency.sos_escalated.title': '{label}SOS not answered',
  'notifications.emergency.sos_escalated.body':
    '{label}No one has acknowledged the SOS at {place} after {seconds} seconds. Respond now.',
  'notifications.emergency.contact.sms':
    'Safezone: {name} raised an emergency alert at {estateName}. Estate security has been notified.',
  'notifications.emergency.contact.email_subject': 'Emergency alert from {name}',
  'notifications.emergency.contact.email_body':
    '{name} raised an emergency alert at {estateName}. Estate security has been notified.',
  'notifications.emergency.broadcast.title': '{title}',
  'notifications.emergency.broadcast.body': '{body}',

  'notifications.community.announcement.title': 'Official: {title}',
  'notifications.community.announcement.body': '{body}',

  'notifications.maintenance.request_urgent.title': 'Urgent request {number}',
  'notifications.maintenance.request_urgent.body': '{title}. Please triage it now.',
  'notifications.maintenance.request_updated.title': 'Request {number}: {status}',
  'notifications.maintenance.request_updated.body': '{title}',
  'notifications.maintenance.work_order_assigned.title': 'New work order {number}',
  'notifications.maintenance.work_order_assigned.body': '{title}',
  'notifications.maintenance.sla_breached.title': 'Request {number} is past its target time',
  'notifications.maintenance.sla_breached.body': '{title} (escalation level {level}).',
  'notifications.utilities.outage.title': 'Outage: {title}',
  'notifications.utilities.outage.body': '{details}',
  'notifications.occupancy.move_scheduled.title': '{kind} at {unitCode} on {date}',
  'notifications.occupancy.move_scheduled.body': 'Check the gate notice for vehicles and items.',
  'notifications.occupancy.move_completed.title': 'Move-out completed at {unitCode}',
  'notifications.occupancy.move_completed.body': 'The unit is now vacant.',
  'notifications.occupancy.lease_expiring.title': 'Lease at {unitCode} ends on {endsOn}',
  'notifications.occupancy.lease_expiring.body':
    '{days} days left. Renew the lease or schedule a move-out.',
  'notifications.occupancy.lease_expired.title': 'Lease at {unitCode} ended today',
  'notifications.occupancy.lease_expired.body': 'Renew the lease or schedule the move-out.',
  'notifications.platform.export_ready.title': 'Your estate data export is ready',
  'notifications.platform.export_ready.body': 'Download it from the management app within 7 days.',
  'notifications.facilities.booking_updated.title': '{facility} booking {outcome}',
  'notifications.facilities.booking_updated.body': 'Starts {startsAt}.',
  'notifications.facilities.booking_reminder.title': 'Reminder: {facility}',
  'notifications.facilities.booking_reminder.body': 'Your booking starts {startsAt}.',
  'notifications.documents.expiring.title': '{title} expires on {expiresOn}',
  'notifications.documents.expiring.body': 'Upload a renewed version before it lapses.',
  'notifications.community.message.title': '{channel}',
  'notifications.community.message.body': '{preview}',
  'notifications.community.moderation.title': 'A moderator took action: {action}',
  'notifications.community.moderation.body': '{reason}. You can appeal in the app.',
  'notifications.community.poll.title': 'New poll',
  'notifications.community.poll.body': '{question}',
  'notifications.billing.payment_received.title': 'Payment received',
  'notifications.billing.payment_received.body': 'We received your payment of {amount}. Thank you.',
  'notifications.billing.invoice_reminder.title': 'Invoice {number} is due on {dueDate}',
  'notifications.billing.invoice_reminder.body':
    '{amount} is still to pay. You can pay in the app.',
  'notifications.billing.invoice_overdue.title': 'Invoice {number} is overdue',
  'notifications.billing.invoice_overdue.body':
    '{amount} was due on {dueDate}. Please pay to avoid a late fee.',
  'notifications.billing.invoice_issued.title': 'New invoice {number}',
  'notifications.billing.invoice_issued.body': '{amount} is due on {dueDate}.',

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
