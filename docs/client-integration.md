# Client integration

Guidance for the web and mobile apps that call the auth API.

## Storing tokens

| Client | Access token | Refresh token |
|---|---|---|
| iOS | Memory | Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) |
| Android | Memory | EncryptedSharedPreferences / Android Keystore |
| React Native / Flutter | Memory | `react-native-keychain` / `flutter_secure_storage` |
| Web SPA | Memory (a JS variable) | See below |

**Never put tokens in URLs or logs.** On the web, avoid `localStorage` for the refresh token if you can: any script injected into the page (XSS) can read it. Options, from most to least secure:

1. **Cookie mode (recommended for web):** turn on `refreshTokenCookie` and the API itself keeps the refresh token in an `HttpOnly; Secure` cookie. Page scripts never see it. See [below](#web-apps-refresh-token-in-a-cookie).
2. **Backend-for-frontend:** a small server on your web domain calls this API and keeps the refresh token in its own cookie. Same protection; useful when you already have such a server.
3. **In memory only:** the user signs in again after a page reload. Simple, and safe for admin dashboards.
4. **`localStorage`:** acceptable only with a strict Content Security Policy and short sessions (`tokens.sessionDays`).

## Calling the API

```ts
const response = await fetch('https://api.myapp.com/rides/mine', {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const body = await response.json();
if (!body.success) handleError(body.code, body);
```

Decide by `code`, never by `message` (see [Error codes](error-codes.md)).

## Refreshing tokens

Refresh when a request fails with `401 INVALID_TOKEN`, or a little before `expiresIn` runs out. Two rules matter:

1. **Store the new refresh token every time.** The old one is now used up.
2. **Only one refresh at a time.** If five requests fail together and all five refresh with the same token, the second one looks like token theft and the session is ended.

```ts
let refreshInFlight: Promise<void> | null = null;

async function refreshTokens(): Promise<void> {
  // Every caller waits for the same refresh.
  refreshInFlight ??= (async () => {
    const response = await fetch('https://api.myapp.com/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: await secureStore.get('refreshToken') }),
    });
    const body = await response.json();
    if (!body.success) {
      await signOutLocally();        // session over: go to sign-in
      throw new Error(body.code);
    }
    accessToken = body.accessToken;
    await secureStore.set('refreshToken', body.refreshToken);
  })().finally(() => (refreshInFlight = null));
  return refreshInFlight;
}

async function apiFetch(path: string, init: RequestInit = {}, isRetry = false): Promise<any> {
  const response = await fetch(`https://api.myapp.com${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  if (response.status === 401 && body.code === 'INVALID_TOKEN' && !isRetry) {
    await refreshTokens();
    return apiFetch(path, init, true);
  }
  return body;
}
```

On mobile, also make sure two app processes (e.g. the app and a widget) don't refresh at the same time.

## Web apps: refresh token in a cookie

```ts
AuthModule.forRoot({
  useFactory: () => ({
    // ...
    refreshTokenCookie: { allowedOrigins: ['https://app.myapp.com'] },
  }),
});
```

Your API must also allow these origins with credentials in CORS: `app.enableCors({ origin: ['https://app.myapp.com'], credentials: true })`.

What changes, **only for requests whose `Origin` header is in `allowedOrigins`** (browsers add it themselves; mobile apps and servers don't send it, so they keep getting the refresh token in the body from the same API):

- Every response that used to contain `refreshToken` now sets the cookie `__Host-refresh_token` (`HttpOnly; Secure; SameSite=Strict; Path=/`) and says `"refreshTokenInCookie": true` instead.
- Refresh with an empty body and `credentials: 'include'`. A refresh that uses the cookie is refused (`403`) unless it comes from an allowed origin, which blocks cross-site request forgery.
- Logout, logout everywhere, deactivate and delete account clear the cookie.

```ts
async function refreshTokens(): Promise<void> {
  refreshInFlight ??= (async () => {
    const response = await fetch('https://api.myapp.com/auth/refresh', {
      method: 'POST',
      credentials: 'include',                     // send the cookie
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await response.json();
    if (!body.success) {
      await signOutLocally();
      throw new Error(body.code);
    }
    accessToken = body.accessToken;               // the access token still lives in memory only
  })().finally(() => (refreshInFlight = null));
  return refreshInFlight;
}
```

Send `credentials: 'include'` on sign-in requests too, so the browser stores the cookie. After a page reload, call `refreshTokens()` once to get a new access token.

Options: `name` (default `__Host-refresh_token`), `domain` (to share with subdomains; not allowed with a `__Host-` name), `path` (default `/`), `sameSite` (default `Strict`; use `Lax` when the web app and the API are on different sites, e.g. `myapp.com` and `myapp-api.com`). Browsers accept `Secure` cookies on `http://localhost`, so cookie mode works in local development.

## Changing email

1. Signed in: `POST /auth/email/change` with `newEmail` (and `currentPassword` if the user has a password). Show "check your new inbox".
2. Your page for the emailed link (`confirm_email_change`) calls `POST /auth/email/change/confirm` with the token.
3. If the response is `403 RECENT_SIGN_IN_REQUIRED`, ask the user to sign in again, then retry.

## Handling the sign-in result

```ts
async function handleSignInResponse(body: any) {
  if (body.success && body.status === 'signed_in') return saveTokensAndEnterApp(body);
  if (body.success && body.status === 'two_factor_required') return showTwoFactorScreen(body.challengeToken);

  switch (body.code) {
    case 'ACCOUNT_NOT_VERIFIED':
      return showVerificationScreen(body.pendingVerifications, body.email, body.phoneNumber);
    case 'ACCOUNT_DEACTIVATED':
      return askToReactivate(body.reactivationToken);   // POST /auth/reactivate
    case 'ACCOUNT_SUSPENDED':
      return showContactSupport();
    case 'VALIDATION_ERROR':
      if (body.missingSignUpDetails) return showSignUpDetailsForm(body.missingSignUpDetails); // then retry
      return showFormErrors(body.problems);
    case 'TOO_MANY_REQUESTS':
      return showRetryLater(body.retryAfterSeconds);
    default:
      return showMessage(body.message);
  }
}
```

## After sign-in

- **Onboarding:** if `user.onboardingCompleted` is `false`, show your onboarding. When it's done, your backend calls `UsersService.completeOnboarding`.
- **Pending verification:** `user.pendingVerifications` tells you what to verify, even for active users when the settings change later.
- **Profile screen:** use `GET /auth/me` and `GET /auth/sign-in-methods`.

## Links in emails

Link tokens (`ev_`, `pr_`, `ml_`, `oi_`) arrive in your `emailSender`. Build links to your own pages or deep links:

| Email | Example link | Page calls |
|---|---|---|
| Verify email | `https://myapp.com/verify-email?token=ev_...` | `POST /auth/email/verify` |
| Reset password | `https://myapp.com/reset-password?token=pr_...` | `POST /auth/password/reset` (after the user types a new password) |
| Magic link | `https://myapp.com/magic?token=ml_...` or `myapp://magic?token=...` | `POST /auth/magic-link/verify` |
| Invitation | `https://myapp.com/join?token=oi_...` | `POST /auth/organizations/invitations/accept` (after sign-in) |

Tips:

- Call the API from the page **after a user action** (a button press), not automatically on load. Email security scanners open links automatically and would use up single-use tokens.
- Remove the token from the address bar after reading it (`history.replaceState`).
- Use universal links (iOS) or app links (Android) so magic links open the app.

## Social sign-in on each platform

| Platform | Google | Apple | Facebook |
|---|---|---|---|
| Web | [Google Identity Services](https://developers.google.com/identity/gsi/web): use the `credential` (ID token) | [Sign in with Apple JS](https://developer.apple.com/documentation/signinwithapplejs): `authorization.id_token` | Facebook JS SDK: `authResponse.accessToken` |
| iOS | Google Sign-In SDK: `user.idToken` | `ASAuthorizationAppleIDCredential.identityToken` | Facebook iOS SDK access token |
| Android | Credential Manager + `GetGoogleIdOption`: `idToken` | Web flow | Facebook Android SDK access token |

Add every client id that issues tokens (web, iOS and Android each have one for Google) to `google.clientIds` / `apple.clientIds`.

## Passkeys

Web: use [`@simplewebauthn/browser`](https://simplewebauthn.dev/docs/packages/browser), see [Sign-in flows](sign-in-flows.md#passkeys). Native apps use the platform APIs (iOS `ASAuthorizationPlatformPublicKeyCredentialProvider`, Android Credential Manager) and need your domain's association files:

- **iOS:** `https://myapp.com/.well-known/apple-app-site-association` with `webcredentials`
- **Android:** `https://myapp.com/.well-known/assetlinks.json` with `delegate_permission/common.get_login_creds`

Add the Android app's origin (`android:apk-key-hash:...`) to `passkeys.allowedOrigins`.
