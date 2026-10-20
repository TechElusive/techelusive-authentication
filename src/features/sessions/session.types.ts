import type { OrganizationRole } from '@/constants';

/** How a user proved who they are (see SIGN_IN_METHOD in constants.ts). */
export type { SignInMethod } from '@/constants';

/** What the app gets after signing in or refreshing. */
export interface TokenSet {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

/** What is inside an access token. Read it in your routes with @CurrentUser(). */
export interface AccessTokenClaims {
  /** Issuer: your API's URL. */
  iss: string;
  /** Audience: also your API's URL. */
  aud: string;
  /** The user's id. */
  sub: string;
  /** The session (device) id. */
  sid: string;
  /** App-wide roles, e.g. ["user"]. */
  roles: string[];
  /** How the user signed in, e.g. ["password", "two_factor"]. */
  amr: string[];
  /** Organization the user is working in on this device, if any. */
  org_id?: string;
  org_role?: OrganizationRole;
  iat: number;
  exp: number;
  /** Unique token id. */
  jti: string;
}
