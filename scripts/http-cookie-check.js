// Checks web-app cookie mode over HTTP. Start the playground with
//   REFRESH_TOKEN_COOKIE_ORIGINS=http://localhost:3000 npm run playground
// then run: node scripts/http-cookie-check.js
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
let failures = 0;
let step = 0;

async function call(method, path, { body, token, headers = {} } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: response.status, body: json, setCookie: response.headers.get('set-cookie') };
}
function check(label, condition, detail) {
  step++;
  if (condition) console.log(`  ✓ ${step}. ${label}`);
  else { failures++; console.log(`  ✗ ${step}. ${label}\n      ${JSON.stringify(detail).slice(0, 500)}`); }
}
const cookiePair = (setCookie) => setCookie?.split(';')[0];

(async () => {
  const email = `cookie-${Date.now()}@example.com`;
  const signUpDetails = { firstName: 'Web', lastName: 'User', acceptTerms: true, acceptPrivacyPolicy: true };
  const fromWeb = { Origin: WEB_ORIGIN };

  await call('POST', '/auth/email/send-otp', { body: { email } });
  const code = (await call('GET', `/dev/api/inbox/latest?to=${encodeURIComponent(email)}&type=sign_in_code`)).body.code;
  const signedIn = await call('POST', '/auth/email/verify-otp', { body: { email, code, ...signUpDetails }, headers: fromWeb });
  check(
    'sign-in from the web app: refresh token only in an HttpOnly, Secure, SameSite=Strict cookie',
    signedIn.body.status === 'signed_in' && signedIn.body.refreshToken === undefined && signedIn.body.refreshTokenInCookie === true &&
      /^__Host-refresh_token=rt_/.test(signedIn.setCookie ?? '') && /HttpOnly/.test(signedIn.setCookie) && /Secure/.test(signedIn.setCookie) &&
      /SameSite=Strict/.test(signedIn.setCookie) && /Max-Age=[1-9]/.test(signedIn.setCookie),
    { body: signedIn.body, setCookie: signedIn.setCookie },
  );

  const refreshed = await call('POST', '/auth/refresh', { body: {}, headers: { ...fromWeb, Cookie: cookiePair(signedIn.setCookie) } });
  check(
    'refresh with the cookie from the web app -> new access token, rotated cookie',
    refreshed.status === 200 && typeof refreshed.body.accessToken === 'string' && refreshed.body.refreshToken === undefined &&
      cookiePair(refreshed.setCookie) !== cookiePair(signedIn.setCookie),
    { status: refreshed.status, body: refreshed.body },
  );

  const crossSite = await call('POST', '/auth/refresh', { body: {}, headers: { Origin: 'https://evil.example', Cookie: cookiePair(refreshed.setCookie) } });
  const noOrigin = await call('POST', '/auth/refresh', { body: {}, headers: { Cookie: cookiePair(refreshed.setCookie) } });
  check('cookie refresh from another site or without Origin -> 403', crossSite.status === 403 && noOrigin.status === 403, { crossSite: crossSite.body, noOrigin: noOrigin.body });

  const reused = await call('POST', '/auth/refresh', { body: {}, headers: { ...fromWeb, Cookie: cookiePair(signedIn.setCookie) } });
  check('the first (already rotated) cookie value is refused -> 401', reused.status === 401, reused.body);

  await call('POST', '/auth/email/send-otp', { body: { email: `mobile-${email}` } });
  const mobileCode = (await call('GET', `/dev/api/inbox/latest?to=${encodeURIComponent(`mobile-${email}`)}&type=sign_in_code`)).body.code;
  const mobile = await call('POST', '/auth/email/verify-otp', { body: { email: `mobile-${email}`, code: mobileCode, ...signUpDetails } });
  const mobileRefresh = await call('POST', '/auth/refresh', { body: { refreshToken: mobile.body.refreshToken } });
  check(
    'mobile app on the same API (no Origin): refresh token still in the body, no cookie',
    typeof mobile.body.refreshToken === 'string' && mobile.setCookie === null && typeof mobileRefresh.body.refreshToken === 'string',
    { mobile: mobile.body, setCookie: mobile.setCookie },
  );

  await call('POST', '/auth/email/send-otp', { body: { email: `logout-${email}` } });
  const logoutCode = (await call('GET', `/dev/api/inbox/latest?to=${encodeURIComponent(`logout-${email}`)}&type=sign_in_code`)).body.code;
  const webUser = await call('POST', '/auth/email/verify-otp', { body: { email: `logout-${email}`, code: logoutCode, ...signUpDetails }, headers: fromWeb });
  const logout = await call('POST', '/auth/logout', { token: webUser.body.accessToken, headers: fromWeb });
  check('logout from the web app deletes the cookie (Max-Age=0)', logout.status === 200 && /Max-Age=0/.test(logout.setCookie ?? ''), { logout: logout.body, setCookie: logout.setCookie });

  console.log(failures ? `\n${failures} check(s) FAILED` : `\nAll ${step} cookie checks passed.`);
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
