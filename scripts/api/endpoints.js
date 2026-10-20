/**
 * Single source for the OpenAPI spec (Swagger) and the Postman collection.
 * Paths come from ROUTES in src/constants.ts, so a renamed route can't drift from the docs.
 *
 * Each endpoint:
 *   folder       Postman folder / Swagger tag
 *   name         short title
 *   method       HTTP method
 *   route        [ROUTES group, key]
 *   auth         'public' | 'user' | 'admin'
 *   body         request example; "{{name}}" values are Postman variables (see VARIABLES)
 *   query        query-string example
 *   saves        what to remember from a successful response: { variable: 'path.in.response' }
 *   fetchFromInbox  before sending, read a code/token from the playground's dev inbox:
 *                { variable, to: '{{email}}', type: 'sign_in_code', field: 'code' }
 *   totp         before sending, compute the current authenticator code from {{totpSecret}}
 *   note         extra explanation shown in Swagger and Postman
 */

/** Postman variables with their starting values (also used to fill Swagger examples). */
const VARIABLES = {
  baseUrl: 'http://localhost:3000',
  email: 'asha@example.com',
  password: 'correct horse battery',
  newPassword: 'a brand new passphrase',
  secondEmail: 'ravi@example.com',
  phoneNumber: '+919876543210',
  provider: 'google',
  socialToken: 'paste-the-provider-token-here',
  accessToken: '',
  refreshToken: '',
  sessionId: '',
  userId: '',
  challengeToken: '',
  reactivationToken: '',
  verificationToken: '',
  resetToken: '',
  magicLinkToken: '',
  emailCode: '',
  smsCode: '',
  totpSecret: '',
  totpCode: '',
  backupCode: '',
  invitationToken: '',
  organizationId: '',
  memberUserId: '',
  invitationId: '',
  passkeyId: '',
  apiKey: '',
  apiKeyId: '',
  webhookId: '',
  webhookSecret: '',
  deliveryId: '',
  organizationSlug: 'acme-travels',
  changedEmail: 'asha.new@example.com',
  emailChangeToken: '',
};

const SIGN_IN_SAVES = {
  accessToken: 'accessToken',
  refreshToken: 'refreshToken',
  sessionId: 'sessionId',
  userId: 'user.id',
  challengeToken: 'challengeToken',
};

const SIGN_UP_DETAILS = { firstName: 'Asha', lastName: 'Rao', acceptTerms: true, acceptPrivacyPolicy: true };

const ENDPOINTS = [
  // ----- Email + password -----------------------------------------------------------------------
  {
    folder: '1. Email + password', name: 'Register', method: 'POST', route: ['auth', 'register'], auth: 'public',
    body: { email: '{{email}}', password: '{{password}}', ...SIGN_UP_DETAILS },
    saves: SIGN_IN_SAVES,
    note: 'Default settings: returns verification_required and emails a verification link (see the dev inbox).',
  },
  {
    folder: '1. Email + password', name: 'Resend verification email', method: 'POST', route: ['auth', 'emailSendVerification'], auth: 'public',
    body: { email: '{{email}}' },
  },
  {
    folder: '1. Email + password', name: 'Verify email (token from inbox)', method: 'POST', route: ['auth', 'emailVerify'], auth: 'public',
    body: { token: '{{verificationToken}}' },
    fetchFromInbox: { variable: 'verificationToken', to: '{{email}}', type: 'verify_email', field: 'token' },
  },
  {
    folder: '1. Email + password', name: 'Login', method: 'POST', route: ['auth', 'login'], auth: 'public',
    body: { email: '{{email}}', password: '{{password}}' },
    saves: SIGN_IN_SAVES,
    note: 'Saves accessToken / refreshToken automatically. If 2FA is on, saves challengeToken: then run "Two-factor > Verify 2FA sign-in".',
  },
  {
    folder: '1. Email + password', name: 'Forgot password', method: 'POST', route: ['auth', 'passwordForgot'], auth: 'public',
    body: { email: '{{email}}' },
  },
  {
    folder: '1. Email + password', name: 'Reset password (token from inbox)', method: 'POST', route: ['auth', 'passwordReset'], auth: 'public',
    body: { token: '{{resetToken}}', newPassword: '{{newPassword}}' },
    fetchFromInbox: { variable: 'resetToken', to: '{{email}}', type: 'reset_password', field: 'token' },
    note: 'Signs out every device. Afterwards sign in with {{newPassword}}.',
  },
  {
    folder: '1. Email + password', name: 'Change password', method: 'POST', route: ['auth', 'passwordChange'], auth: 'user',
    body: { currentPassword: '{{password}}', newPassword: '{{newPassword}}' },
  },

  // ----- Passwordless ---------------------------------------------------------------------------
  {
    folder: '2. Passwordless', name: 'Send email code', method: 'POST', route: ['auth', 'emailSendOtp'], auth: 'public',
    body: { email: '{{secondEmail}}' },
    note: 'Needs emailOtp.enabled (the playground turns it on).',
  },
  {
    folder: '2. Passwordless', name: 'Verify email code (code from inbox)', method: 'POST', route: ['auth', 'emailVerifyOtp'], auth: 'public',
    body: { email: '{{secondEmail}}', code: '{{emailCode}}', firstName: 'Ravi', lastName: 'Kumar', acceptTerms: true, acceptPrivacyPolicy: true },
    fetchFromInbox: { variable: 'emailCode', to: '{{secondEmail}}', type: 'sign_in_code', field: 'code' },
    saves: SIGN_IN_SAVES,
  },
  {
    folder: '2. Passwordless', name: 'Send magic link', method: 'POST', route: ['auth', 'magicLinkSend'], auth: 'public',
    body: { email: '{{secondEmail}}' },
  },
  {
    folder: '2. Passwordless', name: 'Verify magic link (token from inbox)', method: 'POST', route: ['auth', 'magicLinkVerify'], auth: 'public',
    body: { token: '{{magicLinkToken}}', firstName: 'Ravi', lastName: 'Kumar', acceptTerms: true, acceptPrivacyPolicy: true },
    fetchFromInbox: { variable: 'magicLinkToken', to: '{{secondEmail}}', type: 'magic_sign_in', field: 'token' },
    saves: SIGN_IN_SAVES,
  },
  {
    folder: '2. Passwordless', name: 'Send phone code', method: 'POST', route: ['auth', 'phoneSendOtp'], auth: 'public',
    body: { phoneNumber: '{{phoneNumber}}' },
    note: 'The playground delivers SMS to the dev inbox instead of a real phone.',
  },
  {
    folder: '2. Passwordless', name: 'Verify phone code (code from inbox)', method: 'POST', route: ['auth', 'phoneVerifyOtp'], auth: 'public',
    body: { phoneNumber: '{{phoneNumber}}', code: '{{smsCode}}', firstName: 'Meera', lastName: 'Shah', acceptTerms: true, acceptPrivacyPolicy: true },
    fetchFromInbox: { variable: 'smsCode', to: '{{phoneNumber}}', type: 'sms_code', field: 'code' },
    saves: SIGN_IN_SAVES,
  },

  // ----- Account and sessions ------------------------------------------------------------------
  { folder: '3. Account and sessions', name: 'Get my profile', method: 'GET', route: ['auth', 'me'], auth: 'user' },
  {
    folder: '3. Account and sessions', name: 'Update my profile', method: 'PATCH', route: ['auth', 'me'], auth: 'user',
    body: { firstName: 'Asha', lastName: 'Rao-Mehta', metadata: { preferredLanguage: 'hi' } },
  },
  { folder: '3. Account and sessions', name: 'My sign-in methods', method: 'GET', route: ['auth', 'signInMethods'], auth: 'user' },
  { folder: '3. Account and sessions', name: 'My devices', method: 'GET', route: ['auth', 'sessions'], auth: 'user' },
  {
    folder: '3. Account and sessions', name: 'Sign out one device', method: 'DELETE', route: ['auth', 'session'], auth: 'user',
    note: 'Uses {{sessionId}} (the current device unless you change it).',
  },
  {
    folder: '3. Account and sessions', name: 'Refresh tokens', method: 'POST', route: ['auth', 'refresh'], auth: 'public',
    body: { refreshToken: '{{refreshToken}}' },
    saves: { accessToken: 'accessToken', refreshToken: 'refreshToken' },
    note: 'Send it twice with the same old token to see reuse detection end the session.',
  },
  { folder: '3. Account and sessions', name: 'Logout (this device)', method: 'POST', route: ['auth', 'logout'], auth: 'user' },
  { folder: '3. Account and sessions', name: 'Logout everywhere', method: 'POST', route: ['auth', 'logoutAll'], auth: 'user' },
  {
    folder: '3. Account and sessions', name: 'Deactivate my account', method: 'POST', route: ['auth', 'deactivate'], auth: 'user',
    note: 'Then "Login" returns ACCOUNT_DEACTIVATED with a reactivationToken (saved automatically).',
  },
  {
    folder: '3. Account and sessions', name: 'Reactivate', method: 'POST', route: ['auth', 'reactivate'], auth: 'public',
    body: { reactivationToken: '{{reactivationToken}}' },
    saves: SIGN_IN_SAVES,
  },
  {
    folder: '3. Account and sessions', name: 'Change my email', method: 'POST', route: ['auth', 'emailChange'], auth: 'user',
    body: { newEmail: '{{changedEmail}}', currentPassword: '{{password}}' },
    note: 'Sends a confirmation link to the new address. Accounts without a password leave out currentPassword but must have signed in within the last 10 minutes.',
  },
  {
    folder: '3. Account and sessions', name: 'Confirm email change (token from inbox)', method: 'POST', route: ['auth', 'emailChangeConfirm'], auth: 'public',
    body: { token: '{{emailChangeToken}}' },
    fetchFromInbox: { variable: 'emailChangeToken', to: '{{changedEmail}}', type: 'confirm_email_change', field: 'token' },
    note: 'Switches the email and tells the old address. Afterwards set the email variable to {{changedEmail}} to keep signing in.',
  },
  { folder: '3. Account and sessions', name: 'Download my data', method: 'GET', route: ['auth', 'exportMyData'], auth: 'user' },
  { folder: '3. Account and sessions', name: 'Health check', method: 'GET', route: ['auth', 'health'], auth: 'public', note: '200 when the database (and Redis, if used) answer, 503 otherwise.' },
  { folder: '3. Account and sessions', name: 'Delete my account', method: 'DELETE', route: ['auth', 'me'], auth: 'user', note: 'Permanent.' },

  // ----- Two-factor -----------------------------------------------------------------------------
  { folder: '4. Two-factor', name: '2FA status', method: 'GET', route: ['twoFactor', 'prefix'], auth: 'user' },
  {
    folder: '4. Two-factor', name: 'Start 2FA setup', method: 'POST', route: ['twoFactor', 'setup'], auth: 'user',
    saves: { totpSecret: 'secret' },
    note: 'Saves the secret. Scan authenticatorAppUrl with Google/Microsoft Authenticator if you want a real app too.',
  },
  {
    folder: '4. Two-factor', name: 'Enable 2FA (code computed for you)', method: 'POST', route: ['twoFactor', 'enable'], auth: 'user',
    body: { code: '{{totpCode}}' }, totp: true,
    saves: { backupCode: 'backupCodes.0' },
  },
  {
    folder: '4. Two-factor', name: 'Verify 2FA sign-in', method: 'POST', route: ['twoFactor', 'verify'], auth: 'public',
    body: { challengeToken: '{{challengeToken}}', code: '{{totpCode}}' }, totp: true,
    saves: SIGN_IN_SAVES,
    note: 'A code works only once: wait for the next 30-second window before reusing, or put {{backupCode}} in "code".',
  },
  {
    folder: '4. Two-factor', name: 'New backup codes', method: 'POST', route: ['twoFactor', 'backupCodes'], auth: 'user',
    body: { code: '{{totpCode}}' }, totp: true,
  },
  {
    folder: '4. Two-factor', name: 'Disable 2FA', method: 'POST', route: ['twoFactor', 'disable'], auth: 'user',
    body: { code: '{{totpCode}}' }, totp: true,
  },

  // ----- Social ---------------------------------------------------------------------------------
  {
    folder: '5. Social sign-in', name: 'Sign in with provider', method: 'POST', route: ['social', 'signIn'], auth: 'public',
    body: { token: '{{socialToken}}', ...SIGN_UP_DETAILS },
    saves: SIGN_IN_SAVES,
    note: 'Easiest with the "Sign in with Google" button on the dev dashboard. In Postman, paste a real ID token into {{socialToken}}.',
  },
  { folder: '5. Social sign-in', name: 'Link provider', method: 'POST', route: ['social', 'link'], auth: 'user', body: { token: '{{socialToken}}' } },
  { folder: '5. Social sign-in', name: 'Unlink provider', method: 'DELETE', route: ['social', 'unlink'], auth: 'user' },

  // ----- Passkeys -------------------------------------------------------------------------------
  {
    folder: '6. Passkeys', name: 'Registration options', method: 'POST', route: ['passkeys', 'registerOptions'], auth: 'user',
    note: 'Passkeys need a browser or phone: use the Passkeys panel on the dev dashboard. These requests show the raw options.',
  },
  { folder: '6. Passkeys', name: 'Sign-in options', method: 'POST', route: ['passkeys', 'signInOptions'], auth: 'public' },
  {
    folder: '6. Passkeys', name: 'Register passkey (from browser response)', method: 'POST', route: ['passkeys', 'registerVerify'], auth: 'user',
    body: { challengeToken: '{{challengeToken}}', name: 'My laptop', response: {} },
  },
  {
    folder: '6. Passkeys', name: 'Sign in with passkey (from browser response)', method: 'POST', route: ['passkeys', 'signInVerify'], auth: 'public',
    body: { challengeToken: '{{challengeToken}}', response: {} },
  },
  { folder: '6. Passkeys', name: 'List my passkeys', method: 'GET', route: ['passkeys', 'prefix'], auth: 'user', saves: { passkeyId: 'passkeys.0.id' } },
  { folder: '6. Passkeys', name: 'Rename passkey', method: 'PATCH', route: ['passkeys', 'passkey'], auth: 'user', body: { name: 'Work laptop' } },
  { folder: '6. Passkeys', name: 'Remove passkey', method: 'DELETE', route: ['passkeys', 'passkey'], auth: 'user' },

  // ----- Organizations --------------------------------------------------------------------------
  {
    folder: '7. Organizations', name: 'Create organization', method: 'POST', route: ['organizations', 'prefix'], auth: 'user',
    body: { name: 'Acme Travels', slug: '{{organizationSlug}}' },
    saves: { organizationId: 'organization.id' },
  },
  { folder: '7. Organizations', name: 'My organizations', method: 'GET', route: ['organizations', 'prefix'], auth: 'user' },
  { folder: '7. Organizations', name: 'Get organization', method: 'GET', route: ['organizations', 'organization'], auth: 'user' },
  {
    folder: '7. Organizations', name: 'Update organization', method: 'PATCH', route: ['organizations', 'organization'], auth: 'user',
    body: { name: 'Acme Travels India', metadata: { city: 'Bengaluru' } },
  },
  {
    folder: '7. Organizations', name: 'Invite member', method: 'POST', route: ['organizations', 'invitations'], auth: 'user',
    body: { email: '{{secondEmail}}', role: 'member' },
  },
  {
    folder: '7. Organizations', name: 'List invitations', method: 'GET', route: ['organizations', 'invitations'], auth: 'user',
    saves: { invitationId: 'invitations.0.id' },
  },
  {
    folder: '7. Organizations', name: 'Accept invitation (as invited user)', method: 'POST', route: ['organizations', 'acceptInvitation'], auth: 'user',
    body: { token: '{{invitationToken}}' },
    fetchFromInbox: { variable: 'invitationToken', to: '{{secondEmail}}', type: 'organization_invitation', field: 'token' },
    note: 'Sign in as {{secondEmail}} first (e.g. "Passwordless > Verify email code"), so the access token is theirs.',
  },
  {
    folder: '7. Organizations', name: 'List members', method: 'GET', route: ['organizations', 'members'], auth: 'user',
    saves: { memberUserId: 'members.1.userId' },
  },
  {
    folder: '7. Organizations', name: 'Change member role', method: 'PATCH', route: ['organizations', 'member'], auth: 'user',
    body: { role: 'admin' },
  },
  { folder: '7. Organizations', name: 'Remove member', method: 'DELETE', route: ['organizations', 'member'], auth: 'user' },
  { folder: '7. Organizations', name: 'Cancel invitation', method: 'DELETE', route: ['organizations', 'invitation'], auth: 'user' },
  {
    folder: '7. Organizations', name: 'Switch active organization', method: 'POST', route: ['organizations', 'switch'], auth: 'user',
    body: { organizationId: '{{organizationId}}' },
    saves: { accessToken: 'accessToken' },
    note: 'The new access token carries org_id and org_role (decode it at jwt.io to see).',
  },
  { folder: '7. Organizations', name: 'Delete organization', method: 'DELETE', route: ['organizations', 'organization'], auth: 'user' },

  // ----- Admin ----------------------------------------------------------------------------------
  {
    folder: '8. Admin', name: 'Search users', method: 'GET', route: ['admin', 'users'], auth: 'admin',
    query: { search: 'example.com', page: '1', pageSize: '20' },
    note: 'Make yourself admin first: dev dashboard > "Make admin", then Login again.',
  },
  { folder: '8. Admin', name: 'Get user details', method: 'GET', route: ['admin', 'user'], auth: 'admin' },
  { folder: '8. Admin', name: 'Update user', method: 'PATCH', route: ['admin', 'user'], auth: 'admin', body: { metadata: { kycStatus: 'approved' } } },
  { folder: '8. Admin', name: 'Set roles', method: 'PUT', route: ['admin', 'userRoles'], auth: 'admin', body: { roles: ['user', 'admin'] } },
  { folder: '8. Admin', name: 'Suspend user', method: 'POST', route: ['admin', 'userSuspend'], auth: 'admin', body: { reason: 'Manual test' } },
  { folder: '8. Admin', name: 'Unsuspend user', method: 'POST', route: ['admin', 'userUnsuspend'], auth: 'admin' },
  { folder: '8. Admin', name: 'Verify user email', method: 'POST', route: ['admin', 'userVerifyEmail'], auth: 'admin' },
  { folder: '8. Admin', name: 'Reset user 2FA', method: 'POST', route: ['admin', 'userResetTwoFactor'], auth: 'admin' },
  { folder: '8. Admin', name: 'Sign user out everywhere', method: 'POST', route: ['admin', 'userLogoutAll'], auth: 'admin' },
  { folder: '8. Admin', name: 'Delete user', method: 'DELETE', route: ['admin', 'user'], auth: 'admin', note: 'Uses {{userId}}: careful, that is you unless you change it.' },
  { folder: '8. Admin', name: 'Get settings', method: 'GET', route: ['admin', 'settings'], auth: 'admin' },
  {
    folder: '8. Admin', name: 'Change settings', method: 'PATCH', route: ['admin', 'settings'], auth: 'admin',
    body: { magicLink: { enabled: true }, security: { notifyOnNewSignIn: true } },
  },
  { folder: '8. Admin', name: 'Reset settings to code defaults', method: 'DELETE', route: ['admin', 'settings'], auth: 'admin' },
  { folder: '8. Admin', name: 'Audit log', method: 'GET', route: ['admin', 'auditLog'], auth: 'admin', query: { page: '1', pageSize: '20' } },
  { folder: '8. Admin', name: 'Stats', method: 'GET', route: ['admin', 'stats'], auth: 'admin' },
  {
    folder: '8. Admin', name: 'Run data cleanup now', method: 'POST', route: ['admin', 'runCleanup'], auth: 'admin',
    note: 'Deletes rows older than settings.retention allows (it also runs every hour). Returns how many rows each step removed.',
  },
  { folder: '8. Admin', name: 'Rotate signing key', method: 'POST', route: ['admin', 'rotateSigningKey'], auth: 'admin' },
  {
    folder: '8. Admin', name: 'Create API key', method: 'POST', route: ['admin', 'apiKeys'], auth: 'admin',
    body: { name: 'Postman test key', scopes: ['rides:read'] },
    saves: { apiKey: 'apiKey', apiKeyId: 'details.id' },
  },
  { folder: '8. Admin', name: 'List API keys', method: 'GET', route: ['admin', 'apiKeys'], auth: 'admin' },
  { folder: '8. Admin', name: 'Revoke API key', method: 'DELETE', route: ['admin', 'apiKey'], auth: 'admin' },
  {
    folder: '8. Admin', name: 'Create webhook (to the playground receiver)', method: 'POST', route: ['admin', 'webhooks'], auth: 'admin',
    body: { url: '{{baseUrl}}/dev/webhook-receiver', eventNames: [], description: 'Playground receiver' },
    saves: { webhookId: 'webhook.id', webhookSecret: 'signingSecret' },
    note: 'Deliveries appear on the dev dashboard with their signature check result.',
  },
  { folder: '8. Admin', name: 'List webhooks', method: 'GET', route: ['admin', 'webhooks'], auth: 'admin' },
  { folder: '8. Admin', name: 'Update webhook', method: 'PATCH', route: ['admin', 'webhook'], auth: 'admin', body: { eventNames: ['user.signed_in', 'user.created'] } },
  { folder: '8. Admin', name: 'Send test delivery', method: 'POST', route: ['admin', 'webhookTest'], auth: 'admin' },
  {
    folder: '8. Admin', name: 'Webhook deliveries', method: 'GET', route: ['admin', 'webhookDeliveries'], auth: 'admin',
    saves: { deliveryId: 'deliveries.0.id' },
  },
  { folder: '8. Admin', name: 'Retry delivery', method: 'POST', route: ['admin', 'webhookRetryDelivery'], auth: 'admin' },
  { folder: '8. Admin', name: 'Rotate webhook secret', method: 'POST', route: ['admin', 'webhookRotateSecret'], auth: 'admin', saves: { webhookSecret: 'signingSecret' } },
  { folder: '8. Admin', name: 'Delete webhook', method: 'DELETE', route: ['admin', 'webhook'], auth: 'admin' },

  // ----- Public keys ----------------------------------------------------------------------------
  { folder: '9. Public keys', name: 'JWKS (public signing keys)', method: 'GET', route: ['wellKnown', 'jwks'], auth: 'public' },
];

/**
 * Requests that exist only in the playground (not part of the library's API): Postman only.
 * `path` replaces `route`; `headers` are extra request headers.
 */
const PLAYGROUND_ENDPOINTS = [
  {
    folder: '10. Playground helpers', name: 'Call an app route with the API key', method: 'GET', path: '/sample/partner-export', auth: 'public',
    headers: { 'x-api-key': '{{apiKey}}' },
    note: 'Create the key first (Admin > Create API key, scope rides:read). After revoking it this returns 401 INVALID_API_KEY.',
  },
  {
    folder: '10. Playground helpers', name: 'Same route with your user token', method: 'GET', path: '/sample/partner-export', auth: 'user',
    note: 'Signed-in users may call routes marked @ApiKeyScopes too.',
  },
  { folder: '10. Playground helpers', name: 'Dev inbox (all emails and SMS)', method: 'GET', path: '/dev/api/inbox', auth: 'public' },
  { folder: '10. Playground helpers', name: 'Auth events', method: 'GET', path: '/dev/api/events', auth: 'public' },
  {
    folder: '10. Playground helpers', name: 'Make me admin', method: 'POST', path: '/dev/api/make-admin', auth: 'public',
    body: { email: '{{email}}' },
    note: 'Then run "Refresh tokens" so the new role is in the access token.',
  },
];

/** Which Postman variable fills each path parameter. */
const PATH_PARAMETER_VARIABLES = {
  provider: 'provider',
  sessionId: 'sessionId',
  passkeyId: 'passkeyId',
  organizationId: 'organizationId',
  memberUserId: 'memberUserId',
  invitationId: 'invitationId',
  userId: 'userId',
  apiKeyId: 'apiKeyId',
  webhookId: 'webhookId',
  deliveryId: 'deliveryId',
};

module.exports = { ENDPOINTS, PLAYGROUND_ENDPOINTS, VARIABLES, PATH_PARAMETER_VARIABLES };
