// End-to-end check of the main flows against a real PostgreSQL database, through the real services.
// Usage: npm run build && DATABASE_URL=postgres://... node scripts/e2e-check.js
// It creates the auth tables, runs the flows, then drops the tables again.
require('reflect-metadata');
const assert = require('node:assert/strict');
const http = require('node:http');
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');
const { DataSource } = require('typeorm');
const lib = require('../dist');
const { totpCodeForTimeStep, timeStepAt } = require('../dist/common/crypto/totp');
const { PasswordAuthService } = require('../dist/features/passwords/password-auth.service');
const { EmailVerificationService } = require('../dist/features/email-links/email-verification.service');
const { PasswordlessAuthService } = require('../dist/features/passwordless/passwordless-auth.service');
const { WebhookDeliveryWorker } = require('../dist/features/webhooks/webhook-delivery.worker');

const sentEmails = [];
const lastEmailTo = (to, type) => [...sentEmails].reverse().find((email) => email.to === to && email.type === type);
const request = { ipAddress: '198.51.100.7', userAgent: 'e2e-check' };
const otherDevice = { ipAddress: '198.51.100.8', userAgent: 'e2e-check-phone' };

async function expectAuthError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

let step = 0;
const ok = (text) => console.log(`  ✓ ${++step}. ${text}`);

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: lib.AUTH_ENTITIES,
    migrations: lib.AUTH_MIGRATIONS,
  });
  await dataSource.initialize();
  await dataSource.runMigrations();

  class AppModule {}
  Module({
    imports: [
      lib.AuthModule.forRoot({
        useFactory: () => ({
          dataSource,
          issuer: 'http://localhost:3000',
          appName: 'E2E',
          encryption: { localKey: Buffer.alloc(32, 9).toString('base64') },
          emailSender: { send: async (email) => void sentEmails.push(email) },
          settings: { password: { rejectBreachedPasswords: false } },
        }),
      }),
    ],
  })(AppModule);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  const passwords = app.get(PasswordAuthService);
  const emailVerification = app.get(EmailVerificationService);
  const passwordless = app.get(PasswordlessAuthService);
  const sessions = app.get(lib.SessionService);
  const users = app.get(lib.UsersService);
  const signIn = app.get(lib.SignInService);
  const twoFactor = app.get(lib.TwoFactorService);
  const settings = app.get(lib.SettingsService);
  const organizations = app.get(lib.OrganizationsService);
  const apiKeys = app.get(lib.ApiKeysService);
  const webhooks = app.get(lib.WebhooksService);
  const signingKeys = app.get(lib.SigningKeysService);
  const currentSettings = () => settings.getSettings();

  // --- Register, verify, sign in -------------------------------------------------------------
  const registered = await passwords.register(
    { email: 'Asha@Example.com', password: 'correct horse battery', firstName: 'Asha', lastName: 'Rao', acceptTerms: true, acceptPrivacyPolicy: true },
    request,
  );
  assert.equal(registered.status, lib.SIGN_IN_STATUS.verificationRequired);
  assert.deepEqual(registered.pendingVerifications, ['email']);
  ok('register returns verification_required and sends a verification email');

  const again = await passwords.register(
    { email: 'asha@example.com', password: 'another password 1', firstName: 'X', lastName: 'Y', acceptTerms: true, acceptPrivacyPolicy: true },
    request,
  );
  assert.deepEqual(again, registered);
  ok('registering an existing email gives the identical response (no enumeration)');

  await expectAuthError(passwords.signInWithPassword('asha@example.com', 'correct horse battery', request), 'ACCOUNT_NOT_VERIFIED');
  await expectAuthError(passwords.signInWithPassword('asha@example.com', 'wrong password!!', request), 'INVALID_CREDENTIALS');
  await expectAuthError(passwords.signInWithPassword('nobody@example.com', 'whatever password', request), 'INVALID_CREDENTIALS');
  ok('unverified account -> ACCOUNT_NOT_VERIFIED; wrong password and unknown email -> same INVALID_CREDENTIALS');

  const verifyToken = lastEmailTo('asha@example.com', 'verify_email').token;
  const verified = await emailVerification.verifyEmail(verifyToken, request);
  assert.equal(verified.status, lib.ACCOUNT_STATUS.active);
  await expectAuthError(emailVerification.verifyEmail(verifyToken, request), 'INVALID_TOKEN');
  ok('verification link activates the account and works only once');

  const signedIn = await passwords.signInWithPassword('asha@example.com', 'correct horse battery', request);
  assert.equal(signedIn.status, lib.SIGN_IN_STATUS.signedIn);
  const claims = await sessions.verifyAccessToken(signedIn.accessToken);
  assert.equal(claims.sub, signedIn.user.id);
  assert.deepEqual(claims.roles, ['user']);
  assert.deepEqual(claims.amr, ['password']);
  ok('sign-in returns tokens; access token verifies with the right claims');

  // --- Refresh and reuse detection -------------------------------------------------------------
  const refreshed = await sessions.refreshSession(signedIn.refreshToken, request, await currentSettings());
  assert.notEqual(refreshed.refreshToken, signedIn.refreshToken);
  await expectAuthError(sessions.refreshSession(signedIn.refreshToken, request, await currentSettings()), 'INVALID_TOKEN');
  await expectAuthError(sessions.refreshSession(refreshed.refreshToken, request, await currentSettings()), 'INVALID_TOKEN');
  ok('refresh rotates the token; reusing the old one ends the whole session');

  const parallel = await passwords.signInWithPassword('asha@example.com', 'correct horse battery', request);
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map(async () => sessions.refreshSession(parallel.refreshToken, request, await currentSettings())));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  ok('five parallel refreshes with one token: exactly one succeeds');

  // --- Two-factor ------------------------------------------------------------------------------
  const device = await passwords.signInWithPassword('asha@example.com', 'correct horse battery', request);
  const setup = await twoFactor.startSetup(device.user.id);
  const currentCode = () => totpCodeForTimeStep(setup.secret, timeStepAt(Math.floor(Date.now() / 1000)));
  await expectAuthError(twoFactor.confirmSetup(device.user.id, device.sessionId, '000000', request), 'INVALID_OTP');
  const enabled = await twoFactor.confirmSetup(device.user.id, device.sessionId, currentCode(), request);
  assert.equal(enabled.backupCodes.length, 10);
  ok('2FA setup rejects a wrong code, accepts the authenticator code, returns 10 backup codes');

  const firstStep = await passwords.signInWithPassword('asha@example.com', 'correct horse battery', otherDevice);
  assert.equal(firstStep.status, lib.SIGN_IN_STATUS.twoFactorRequired);
  await expectAuthError(twoFactor.verifySignInChallenge(firstStep.challengeToken, currentCode(), otherDevice), 'INVALID_OTP');
  ok('sign-in now asks for 2FA; the code already used during setup is refused (no replay)');

  const withBackup = await twoFactor.verifySignInChallenge(firstStep.challengeToken, enabled.backupCodes[0].toUpperCase(), otherDevice);
  assert.equal(withBackup.status, lib.SIGN_IN_STATUS.signedIn);
  assert.deepEqual((await sessions.verifyAccessToken(withBackup.accessToken)).amr, ['password', 'two_factor']);
  await expectAuthError(twoFactor.verifySignInChallenge(firstStep.challengeToken, enabled.backupCodes[1], otherDevice), 'INVALID_TOKEN');
  const secondStep = await passwords.signInWithPassword('asha@example.com', 'correct horse battery', otherDevice);
  await expectAuthError(twoFactor.verifySignInChallenge(secondStep.challengeToken, enabled.backupCodes[0], otherDevice), 'INVALID_OTP');
  ok('backup code signs in (amr has two_factor); challenge and backup code each work once');

  await twoFactor.resetForUser(device.user.id, device.user.id, request);
  ok('admin 2FA reset works');

  // --- Email OTP sign-up -----------------------------------------------------------------------
  await settings.saveAdminChanges({ emailOtp: { enabled: true }, organizations: { enabled: true } }, 'admin:e2e');
  await passwordless.sendEmailCode('ravi@example.com', request);
  await expectAuthError(passwordless.sendEmailCode('ravi@example.com', request), 'TOO_MANY_REQUESTS');
  const code = lastEmailTo('ravi@example.com', 'sign_in_code').code;
  await expectAuthError(passwordless.verifyEmailCode('ravi@example.com', code, {}, request), 'VALIDATION_ERROR');
  const ravi = await passwordless.verifyEmailCode(
    'ravi@example.com',
    code,
    { firstName: 'Ravi', lastName: 'Kumar', acceptTerms: true, acceptPrivacyPolicy: true },
    request,
  );
  assert.equal(ravi.status, lib.SIGN_IN_STATUS.signedIn);
  assert.equal(ravi.user.isEmailVerified, true);
  ok('admin turns on email codes at runtime; resend within a minute refused; missing details keep the code; sign-up works');

  // --- Organizations ---------------------------------------------------------------------------
  const org = await organizations.createOrganization(signedIn.user.id, { name: 'Acme', slug: 'acme' }, false, request);
  await expectAuthError(organizations.createOrganization(ravi.user.id, { name: 'Acme 2', slug: 'acme' }, false, request), 'ORGANIZATION_SLUG_TAKEN');
  await organizations.inviteMember(org.id, signedIn.user.id, 'ravi@example.com', 'member', request);
  const invitationToken = lastEmailTo('ravi@example.com', 'organization_invitation').token;
  await organizations.acceptInvitation(ravi.user.id, invitationToken, request);
  const members = await organizations.listMembers(org.id, ravi.user.id);
  assert.equal(members.length, 2);
  const switched = await organizations.switchActiveOrganization(ravi.user.id, ravi.sessionId, org.id);
  const orgClaims = await sessions.verifyAccessToken(switched.accessToken);
  assert.equal(orgClaims.org_id, org.id);
  assert.equal(orgClaims.org_role, 'member');
  await expectAuthError(organizations.removeMember(org.id, signedIn.user.id, signedIn.user.id, request), 'LAST_OWNER');
  await expectAuthError(organizations.updateOrganization(org.id, ravi.user.id, { name: 'Hacked' }, request), 'FORBIDDEN');
  ok('organization create, invite, accept, switch (org claims in token), last-owner and role checks');

  // --- API keys --------------------------------------------------------------------------------
  const created = await apiKeys.createApiKey({ name: 'Partner', scopes: ['orders:read'] }, signedIn.user.id, request);
  const key = await apiKeys.verifyApiKey(created.apiKey);
  assert.deepEqual(key.scopes, ['orders:read']);
  await apiKeys.revokeApiKey(created.details.id, signedIn.user.id, request);
  await expectAuthError(apiKeys.verifyApiKey(created.apiKey), 'INVALID_API_KEY');
  ok('API key works, then stops working once revoked');

  // --- Webhooks --------------------------------------------------------------------------------
  const received = [];
  const server = http.createServer((incoming, response) => {
    let body = '';
    incoming.on('data', (chunk) => (body += chunk));
    incoming.on('end', () => {
      received.push({ body, signature: incoming.headers['x-techelusive-signature'], event: incoming.headers['x-techelusive-event'] });
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const hook = await webhooks.createWebhook({ url: `http://127.0.0.1:${server.address().port}/hook`, eventNames: ['user.suspended'] });
  await expectAuthError(webhooks.createWebhook({ url: 'https://169.254.169.254/latest' }), 'UNSAFE_WEBHOOK_URL');

  // --- Account life cycle ----------------------------------------------------------------------
  await users.suspendUser(ravi.user.id, 'test suspension', signedIn.user.id, request);
  assert.equal(await sessions.isSessionStillAllowed(ravi.sessionId, ravi.user.id), false);
  await passwordless.sendEmailCode('ravi@example.com', request).catch(() => undefined);
  await app.get(WebhookDeliveryWorker).sendDueDeliveries();
  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'user.suspended');
  assert.equal(lib.verifyWebhookSignature(hook.signingSecret, received[0].body, received[0].signature), true);
  server.close();
  ok('suspending ends sessions; signed webhook delivered and verifies; private address refused');

  await users.liftSuspension(ravi.user.id, signedIn.user.id, await currentSettings(), request);
  await users.deactivateAccount(signedIn.user.id, request);
  const deactivated = await passwords.signInWithPassword('asha@example.com', 'correct horse battery', request).catch((error) => error);
  assert.equal(deactivated.code, 'ACCOUNT_DEACTIVATED');
  const reactivationToken = deactivated.getResponse().reactivationToken;
  const back = await signIn.reactivateAndSignIn(reactivationToken, request, await currentSettings());
  assert.equal(back.status, lib.SIGN_IN_STATUS.signedIn);
  ok('deactivate -> sign-in offers reactivation -> reactivated and signed in');

  await users.deleteUser(ravi.user.id, null, request);
  await expectAuthError(passwords.signInWithPassword('ravi@example.com', 'anything at all', request), 'INVALID_CREDENTIALS');
  const [deletedRow] = await dataSource.query('SELECT email, first_name, status FROM auth_users WHERE id = $1', [ravi.user.id]);
  assert.deepEqual(deletedRow, { email: null, first_name: null, status: 'DELETED' });
  ok('delete wipes personal data and the account can no longer sign in');

  // --- Keys and rate limits --------------------------------------------------------------------
  const oldToken = back.accessToken;
  await signingKeys.rotateSigningKey();
  await sessions.verifyAccessToken(oldToken);
  ok('signing key rotation: tokens signed by the old key still verify');

  let limited = false;
  for (let attempt = 0; attempt < 12 && !limited; attempt++) {
    const result = await passwords.signInWithPassword('asha@example.com', 'wrong password!!', request).catch((error) => error);
    limited = result.code === 'TOO_MANY_REQUESTS';
  }
  assert.equal(limited, true);
  ok('repeated wrong passwords hit the per-account rate limit');

  await app.close();
  await dataSource.undoLastMigration();
  await dataSource.destroy();
  console.log(`\nAll ${step} end-to-end checks passed.`);
}

main().catch((error) => {
  console.error('\nE2E FAILED:', error);
  process.exit(1);
});
