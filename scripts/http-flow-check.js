// Every main flow over real HTTP, against a running playground (CI runs it on every change).
// Usage: npm run playground (in another terminal), then
//        DATABASE_URL=<the playground's database> node scripts/http-flow-check.js
// DATABASE_URL is used only to make some rows look old, to test the data-retention cleanup.
const { Client } = require('pg');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
let failures = 0, step = 0;
const state = {};

async function call(method, path, { body, token, headers = {} } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: response.status, body: json, headers: response.headers };
}
function check(label, condition, detail) {
  step++;
  if (condition) console.log(`  ✓ ${step}. ${label}`);
  else { failures++; console.log(`  ✗ ${step}. ${label}\n      ${JSON.stringify(detail).slice(0, 400)}`); }
}
const latest = async (to, type) => (await call('GET', `/dev/api/inbox/latest?to=${encodeURIComponent(to)}&type=${type}`)).body;

(async () => {
  const pages = await Promise.all([call('GET', '/dev'), call('GET', '/docs'), call('GET', '/docs/openapi.json'), call('GET', '/.well-known/jwks.json')]);
  check('dashboard, Swagger page, OpenAPI spec and JWKS load', pages.every((page) => page.status === 200) && pages[2].body.openapi && pages[3].body.keys.length === 1, pages.map((page) => page.status));

  const unauth = await call('GET', '/auth/me');
  check('protected route without token -> 401 UNAUTHORIZED in the standard format', unauth.status === 401 && unauth.body.success === false && unauth.body.code === 'UNAUTHORIZED', unauth);

  const extra = await call('POST', '/auth/register', { body: { email: 'asha@example.com', password: 'correct horse battery', roles: ['admin'] } });
  check('unknown body field rejected -> 400 VALIDATION_ERROR with problems', extra.status === 400 && extra.body.code === 'VALIDATION_ERROR' && extra.body.problems?.some((p) => p.includes('roles')), extra);

  const user = { email: 'asha@example.com', password: 'correct horse battery', firstName: 'Asha', lastName: 'Rao', acceptTerms: true, acceptPrivacyPolicy: true };
  const registered = await call('POST', '/auth/register', { body: user });
  check('register -> 201 verification_required', registered.status === 201 && registered.body.status === 'verification_required', registered);
  const again = await call('POST', '/auth/register', { body: user });
  check('register same email -> identical response', JSON.stringify(again.body) === JSON.stringify(registered.body), again);

  const unverified = await call('POST', '/auth/login', { body: { email: user.email, password: user.password } });
  check('login unverified -> 403 ACCOUNT_NOT_VERIFIED with pendingVerifications', unverified.status === 403 && unverified.body.code === 'ACCOUNT_NOT_VERIFIED' && unverified.body.pendingVerifications?.[0] === 'email', unverified);

  const verification = await latest(user.email, 'verify_email');
  const verified = await call('POST', '/auth/email/verify', { body: { token: verification.token } });
  check('verify email via inbox token -> ACTIVE', verified.status === 200 && verified.body.status === 'ACTIVE', verified);

  const login = await call('POST', '/auth/login', { body: { email: user.email, password: user.password } });
  check('login -> 200 signed_in', login.status === 200 && login.body.status === 'signed_in', login);
  state.token = login.body.accessToken; state.refresh = login.body.refreshToken; state.userId = login.body.user?.id; state.sessionId = login.body.sessionId;

  const me = await call('GET', '/auth/me', { token: state.token });
  check('GET /auth/me with token', me.status === 200 && me.body.user?.email === user.email, me);
  const patch = await call('PATCH', '/auth/me', { token: state.token, body: { lastName: 'Rao-Mehta', metadata: { lang: 'hi' } } });
  check('PATCH /auth/me updates name and metadata', patch.body.user?.lastName === 'Rao-Mehta' && patch.body.user?.metadata?.lang === 'hi', patch);

  const badUuid = await call('DELETE', '/auth/sessions/not-a-uuid', { token: state.token });
  check('non-uuid path param -> 400', badUuid.status === 400 && badUuid.body.success === false, badUuid);

  const refreshed = await call('POST', '/auth/refresh', { body: { refreshToken: state.refresh } });
  const reused = await call('POST', '/auth/refresh', { body: { refreshToken: state.refresh } });
  check('refresh works; reusing old refresh token -> 401 INVALID_TOKEN', refreshed.status === 200 && reused.status === 401 && reused.body.code === 'INVALID_TOKEN', { refreshed: refreshed.status, reused });
  const afterReuse = await call('GET', '/auth/me', { token: refreshed.body.accessToken });
  check('session ended by reuse: /auth/me with the new token -> 401', afterReuse.status === 401, afterReuse);

  const login2 = await call('POST', '/auth/login', { body: { email: user.email, password: user.password } });
  state.token = login2.body.accessToken; state.refresh = login2.body.refreshToken;

  // 2FA over HTTP
  const setup = await call('POST', '/auth/2fa/setup', { token: state.token });
  const code1 = (await call('GET', `/dev/api/totp?secret=${setup.body.secret}`)).body.code;
  const enable = await call('POST', '/auth/2fa/enable', { token: state.token, body: { code: code1 } });
  check('2FA setup + enable (code from /dev/api/totp) -> 10 backup codes', enable.status === 200 && enable.body.backupCodes?.length === 10, enable);
  const firstStep = await call('POST', '/auth/login', { body: { email: user.email, password: user.password } });
  const backup = await call('POST', '/auth/2fa/verify', { body: { challengeToken: firstStep.body.challengeToken, code: enable.body.backupCodes[0] } });
  check('login -> two_factor_required; backup code -> signed_in', firstStep.body.status === 'two_factor_required' && backup.body.status === 'signed_in', { firstStep: firstStep.body, backup: backup.body });
  state.token = backup.body.accessToken; state.refresh = backup.body.refreshToken;
  const disabled = await call('POST', '/auth/2fa/disable', { token: state.token, body: { code: enable.body.backupCodes[1] } });
  check('disable 2FA with another backup code', disabled.status === 200, disabled);

  // Passwordless
  await call('POST', '/auth/email/send-otp', { body: { email: 'ravi@example.com' } });
  const tooSoon = await call('POST', '/auth/email/send-otp', { body: { email: 'ravi@example.com' } });
  check('resend code within a minute -> 429 with Retry-After header', tooSoon.status === 429 && tooSoon.headers.get('retry-after') === '60', { status: tooSoon.status, retry: tooSoon.headers.get('retry-after') });
  const emailCode = (await latest('ravi@example.com', 'sign_in_code')).code;
  const missing = await call('POST', '/auth/email/verify-otp', { body: { email: 'ravi@example.com', code: emailCode } });
  check('verify code without names -> 400 missingSignUpDetails', missing.status === 400 && missing.body.missingSignUpDetails?.includes('firstName'), missing);
  const ravi = await call('POST', '/auth/email/verify-otp', { body: { email: 'ravi@example.com', code: emailCode, firstName: 'Ravi', lastName: 'Kumar', acceptTerms: true, acceptPrivacyPolicy: true } });
  check('same code with names -> signed_in (new user)', ravi.body.status === 'signed_in', ravi);
  state.raviToken = ravi.body.accessToken; state.raviId = ravi.body.user?.id;

  await call('POST', '/auth/phone/send-otp', { body: { phoneNumber: '+91 98765 43210' } });
  const sms = await latest('+919876543210', 'sms_code');
  const phone = await call('POST', '/auth/phone/verify-otp', { body: { phoneNumber: '+919876543210', code: sms.code, firstName: 'Meera', lastName: 'Shah', acceptTerms: true, acceptPrivacyPolicy: true } });
  check('phone code via dev inbox SMS -> signed_in phone-only user', phone.body.status === 'signed_in' && phone.body.user?.email === null && phone.body.user?.isPhoneVerified === true, phone);

  await call('POST', '/auth/magic-link/send', { body: { email: user.email } });
  const magic = await latest(user.email, 'magic_sign_in');
  const magicSignIn = await call('POST', '/auth/magic-link/verify', { body: { token: magic.token } });
  check('magic link -> signed_in', magicSignIn.body.status === 'signed_in', magicSignIn);

  // Admin without role, then make admin
  const forbidden = await call('GET', '/auth/admin/users', { token: state.token });
  check('admin route without admin role -> 403 FORBIDDEN', forbidden.status === 403 && forbidden.body.code === 'FORBIDDEN', forbidden);
  await call('POST', '/dev/api/make-admin', { body: { email: user.email } });
  const adminRefresh = await call('POST', '/auth/refresh', { body: { refreshToken: state.refresh } });
  state.token = adminRefresh.body.accessToken; state.refresh = adminRefresh.body.refreshToken;
  const search = await call('GET', '/auth/admin/users?search=example.com&page=1&pageSize=20', { token: state.token });
  check('make admin + refresh -> admin search with query paging works', search.status === 200 && search.body.total >= 2 && search.body.pageSize === 20, search);

  const badSettings = await call('PATCH', '/auth/admin/settings', { token: state.token, body: { tokens: { accessTokenMinutes: 999 } } });
  check('invalid settings -> 400 INVALID_SETTINGS with problems', badSettings.status === 400 && badSettings.body.code === 'INVALID_SETTINGS' && badSettings.body.problems?.length, badSettings);
  await call('PATCH', '/auth/admin/settings', { token: state.token, body: { magicLink: { enabled: false } } });
  const magicOff = await call('POST', '/auth/magic-link/send', { body: { email: user.email } });
  check('runtime setting turns magic link off -> 403 SIGN_IN_METHOD_DISABLED', magicOff.status === 403 && magicOff.body.code === 'SIGN_IN_METHOD_DISABLED', magicOff);
  await call('DELETE', '/auth/admin/settings', { token: state.token });

  // Timings are settings too: a shorter resend wait takes effect at once; unsafe values are refused.
  await call('PATCH', '/auth/admin/settings', { token: state.token, body: { emailOtp: { resendAfterSeconds: 30 }, magicLink: { expiresInMinutes: 30 } } });
  await call('POST', '/auth/email/send-otp', { body: { email: 'timing@example.com' } });
  const quickResend = await call('POST', '/auth/email/send-otp', { body: { email: 'timing@example.com' } });
  const tooLong = await call('PATCH', '/auth/admin/settings', { token: state.token, body: { passwordReset: { linkExpiresInMinutes: 100000 } } });
  const timingSettings = (await call('GET', '/auth/admin/settings', { token: state.token })).body.settings;
  check(
    'timings in settings: resendAfterSeconds 30 -> Retry-After 30; magic link 30 min saved; a month-long reset link refused',
    quickResend.status === 429 && quickResend.headers.get('retry-after') === '30' && timingSettings.magicLink.expiresInMinutes === 30 &&
      tooLong.body.code === 'INVALID_SETTINGS' && tooLong.body.problems?.some((problem) => problem.includes('passwordReset.linkExpiresInMinutes')),
    { quickResend: quickResend.body, retryAfter: quickResend.headers.get('retry-after'), tooLong: tooLong.body },
  );
  await call('DELETE', '/auth/admin/settings', { token: state.token });

  // Webhook to the playground receiver
  const hook = await call('POST', '/auth/admin/webhooks', { token: state.token, body: { url: `${BASE}/dev/webhook-receiver`, eventNames: [] } });
  const unsafe = await call('POST', '/auth/admin/webhooks', { token: state.token, body: { url: 'https://169.254.169.254/x' } });
  check('webhook created (201, secret once); metadata address refused', hook.status === 201 && hook.body.signingSecret?.startsWith('whsec_') && unsafe.body.code === 'UNSAFE_WEBHOOK_URL', { hook: hook.status, unsafe: unsafe.body });
  await call('POST', '/auth/login', { body: { email: user.email, password: user.password } });
  await new Promise((resolve) => setTimeout(resolve, 7000));
  const received = (await call('GET', '/dev/api/webhook-deliveries')).body.deliveries;
  check('worker delivered events to the receiver with valid signatures', received.length > 0 && received.every((delivery) => delivery.isSignatureValid), received.map((d) => [d.eventName, d.isSignatureValid]));

  // API keys on an app route
  const key = await call('POST', '/auth/admin/api-keys', { token: state.token, body: { name: 'Partner', scopes: ['rides:read'] } });
  const withKey = await call('GET', '/sample/partner-export', { headers: { 'x-api-key': key.body.apiKey } });
  const noKey = await call('GET', '/sample/partner-export');
  await call('DELETE', `/auth/admin/api-keys/${key.body.details.id}`, { token: state.token });
  const revoked = await call('GET', '/sample/partner-export', { headers: { 'x-api-key': key.body.apiKey } });
  check('API key: works on app route, missing -> 401, revoked -> 401 INVALID_API_KEY', withKey.status === 200 && withKey.body.calledBy?.name === 'Partner' && noKey.status === 401 && revoked.body.code === 'INVALID_API_KEY', { withKey: withKey.body, noKey: noKey.status, revoked: revoked.body });

  // Organizations
  const org = await call('POST', '/auth/organizations', { token: state.token, body: { name: 'Acme Travels', slug: 'acme-travels' } });
  await call('POST', `/auth/organizations/${org.body.organization.id}/invitations`, { token: state.token, body: { email: 'ravi@example.com', role: 'member' } });
  const invitation = await latest('ravi@example.com', 'organization_invitation');
  const accept = await call('POST', '/auth/organizations/invitations/accept', { token: state.raviToken, body: { token: invitation.token } });
  const switched = await call('POST', '/auth/organizations/switch', { token: state.raviToken, body: { organizationId: org.body.organization.id } });
  const claims = JSON.parse(Buffer.from(switched.body.accessToken.split('.')[1], 'base64url').toString());
  const memberEdit = await call('PATCH', `/auth/organizations/${org.body.organization.id}`, { token: switched.body.accessToken, body: { name: 'Hacked' } });
  check('org create (201), invite, accept, switch -> org claims; member edit -> 403', org.status === 201 && accept.status === 200 && claims.org_role === 'member' && memberEdit.status === 403, { org: org.status, accept: accept.body, claims, memberEdit: memberEdit.status });

  // Suspend over HTTP
  await call('POST', `/auth/admin/users/${state.raviId}/suspend`, { token: state.token, body: { reason: 'smoke test' } });
  const suspendedMe = await call('GET', '/auth/me', { token: state.raviToken });
  check('suspended user: /auth/me -> 401 (sessions ended)', suspendedMe.status === 401, suspendedMe);

  const audit = await call('GET', '/auth/admin/audit-log?pageSize=5', { token: state.token });
  const events = (await call('GET', '/dev/api/events')).body.events;
  check('audit log via admin API; live events on the dashboard feed', audit.body.entries?.length === 5 && events.length > 10, { audit: audit.status, events: events.length });


  // Email change (password account): wrong password refused; link to the new address switches it.
  const wrongPassword = await call('POST', '/auth/email/change', { token: state.token, body: { newEmail: 'asha.new@example.com', currentPassword: 'not my password' } });
  const takenRequest = await call('POST', '/auth/email/change', { token: state.token, body: { newEmail: 'ravi@example.com', currentPassword: user.password } });
  const changeRequest = await call('POST', '/auth/email/change', { token: state.token, body: { newEmail: 'Asha.New@Example.com', currentPassword: user.password } });
  const confirmation = await latest('asha.new@example.com', 'confirm_email_change');
  const takenGotNoLink = (await call('GET', '/dev/api/inbox/latest?to=ravi@example.com&type=confirm_email_change')).status === 404;
  const confirmed = await call('POST', '/auth/email/change/confirm', { body: { token: confirmation.token } });
  const oldAddressNotice = await latest(user.email, 'email_changed');
  const reusedLink = await call('POST', '/auth/email/change/confirm', { body: { token: confirmation.token } });
  const oldEmailLogin = await call('POST', '/auth/login', { body: { email: user.email, password: user.password } });
  const newEmailLogin = await call('POST', '/auth/login', { body: { email: 'asha.new@example.com', password: user.password } });
  check(
    'email change: wrong password 401, taken address answers the same but gets no link, confirm switches, old address told, link single-use',
    wrongPassword.status === 401 &&
      takenRequest.status === 200 && takenRequest.body.message === changeRequest.body.message && takenGotNoLink &&
      confirmed.status === 200 && confirmed.body.user?.email === 'asha.new@example.com' && confirmed.body.user?.isEmailVerified === true &&
      oldAddressNotice?.details?.newEmail === 'a***@example.com' && reusedLink.status === 400 &&
      oldEmailLogin.status === 401 && newEmailLogin.body.status === 'signed_in',
    { wrongPassword: wrongPassword.status, takenRequest: takenRequest.body, confirmed: confirmed.body, oldAddressNotice, reusedLink: reusedLink.status, oldEmailLogin: oldEmailLogin.status, newEmailLogin: newEmailLogin.body.status },
  );
  user.email = 'asha.new@example.com';
  state.token = newEmailLogin.body.accessToken; state.refresh = newEmailLogin.body.refreshToken;

  // Email change (account without a password): allowed right after signing in; same email refused.
  await call('POST', '/auth/phone/send-otp', { body: { phoneNumber: '+919876500001' } });
  const smsForNew = await latest('+919876500001', 'sms_code');
  const phoneUser = await call('POST', '/auth/phone/verify-otp', { body: { phoneNumber: '+919876500001', code: smsForNew.code, firstName: 'Kiran', lastName: 'Das', acceptTerms: true, acceptPrivacyPolicy: true } });
  const addEmail = await call('POST', '/auth/email/change', { token: phoneUser.body.accessToken, body: { newEmail: 'kiran@example.com' } });
  const kiranLink = await latest('kiran@example.com', 'confirm_email_change');
  const kiranConfirmed = await call('POST', '/auth/email/change/confirm', { body: { token: kiranLink.token } });
  const sameEmail = await call('POST', '/auth/email/change', { token: phoneUser.body.accessToken, body: { newEmail: 'kiran@example.com' } });
  check(
    'email change without a password: works after a recent sign-in (phone user adds an email); same email -> 400 EMAIL_UNCHANGED',
    addEmail.status === 200 && kiranConfirmed.body.user?.email === 'kiran@example.com' && sameEmail.body.code === 'EMAIL_UNCHANGED',
    { addEmail: addEmail.body, kiranConfirmed: kiranConfirmed.body, sameEmail: sameEmail.body },
  );

  // Download my data: profile and history, never secrets.
  const exported = await call('GET', '/auth/me/export', { token: state.token });
  const exportText = JSON.stringify(exported.body);
  check(
    'GET /auth/me/export: profile, devices, organizations, history; no hashes, secrets or tokens',
    exported.status === 200 && exported.body.profile?.email === user.email && exported.body.devices?.length > 0 &&
      exported.body.organizations?.[0]?.name === 'Acme Travels' && exported.body.securityHistory?.length > 0 &&
      !/hash|secret|rt_|ev_|ec_|"token"/i.test(exportText),
    { status: exported.status, keys: Object.keys(exported.body ?? {}) },
  );

  // Health and admin stats.
  const health = await call('GET', '/auth/health');
  const stats = await call('GET', '/auth/admin/stats', { token: state.token });
  const statsAsUser = await call('GET', '/auth/admin/stats', { token: phoneUser.body.accessToken });
  check(
    'GET /auth/health (public) -> ok; admin stats count users, sessions and last-24h sign-ins; non-admin -> 403',
    health.status === 200 && health.body.checks?.database === 'ok' &&
      stats.body.usersByStatus?.ACTIVE >= 3 && stats.body.activeSessions > 0 && stats.body.last24Hours?.signIns > 5 &&
      statsAsUser.status === 403,
    { health: health.body, stats: stats.body, statsAsUser: statsAsUser.status },
  );

  // Data retention: rows made to look old are removed; recent and live rows stay.
  if (process.env.DATABASE_URL) {
    const database = new Client({ connectionString: process.env.DATABASE_URL });
    await database.connect();
    await database.query(`UPDATE auth_sessions SET revoked_at = now() - interval '30 days' WHERE revoked_at IS NOT NULL`);
    await database.query(`UPDATE auth_one_time_codes SET expires_at = now() - interval '30 days'`);
    await database.query(`UPDATE auth_audit_logs SET created_at = now() - interval '400 days' WHERE event_name = 'user.sign_in_failed'`);
    // A password-less account whose sign-in was long ago must sign in again before changing email.
    await database.query(`UPDATE auth_sessions SET created_at = now() - interval '1 hour' WHERE user_id = $1`, [phoneUser.body.user.id]);
    const staleSession = await call('POST', '/auth/email/change', { token: phoneUser.body.accessToken, body: { newEmail: 'kiran.two@example.com' } });
    check('email change without a password, signed in an hour ago -> 403 RECENT_SIGN_IN_REQUIRED', staleSession.status === 403 && staleSession.body.code === 'RECENT_SIGN_IN_REQUIRED', staleSession.body);

    const before = (await database.query(`SELECT count(*)::int AS count FROM auth_audit_logs`)).rows[0].count;
    const cleanup = await call('POST', '/auth/admin/maintenance/cleanup', { token: state.token });
    const after = await database.query(`
      SELECT (SELECT count(*) FROM auth_sessions WHERE revoked_at IS NOT NULL)::int AS ended_sessions,
             (SELECT count(*) FROM auth_one_time_codes)::int AS codes,
             (SELECT count(*) FROM auth_audit_logs WHERE event_name = 'user.sign_in_failed')::int AS old_entries,
             (SELECT count(*) FROM auth_audit_logs)::int AS entries,
             (SELECT count(*) FROM auth_users)::int AS users`);
    await database.end();
    const remaining = after.rows[0];
    const stillSignedIn = await call('GET', '/auth/me', { token: state.token });
    check(
      'cleanup removes old ended sessions, expired codes and old audit entries; users, recent history and live sessions stay',
      cleanup.status === 200 && cleanup.body.removed?.endedSessions > 0 && cleanup.body.removed?.oneTimeCodes > 0 &&
        remaining.ended_sessions === 0 && remaining.codes === 0 && remaining.old_entries === 0 &&
        remaining.entries > 0 && remaining.entries < before && remaining.users >= 4 && stillSignedIn.status === 200,
      { cleanup: cleanup.body, remaining, before },
    );
  } else {
    console.log('  - skipped the data-retention check (set DATABASE_URL to run it)');
  }

  let limited = false;
  for (let attempt = 0; attempt < 12 && !limited; attempt++) {
    const wrong = await call('POST', '/auth/login', { body: { email: user.email, password: 'wrong password!!' } });
    limited = wrong.status === 429;
  }
  check('repeated wrong passwords -> 429', limited, null);

  console.log(failures ? `\n${failures} check(s) FAILED` : `\nAll ${step} HTTP checks passed.`);
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
