import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { AuthOptions, RefreshTokenCookieOptions } from '@/auth-options';
import {
  AUTH_ERRORS,
  AUTH_OPTIONS_TOKEN,
  COOKIE_ATTRIBUTE,
  COOKIE_ATTRIBUTE_SEPARATOR,
  COOKIE_NAME_VALUE_SEPARATOR,
  COOKIE_PAIR_SEPARATOR,
  HTTP_CONTEXT_TYPE,
  HTTP_HEADER,
  METADATA_KEY,
  REFRESH_TOKEN_COOKIE_DEFAULTS,
  REFRESH_TOKEN_EXPIRES_AT_RESPONSE_FIELD,
  REFRESH_TOKEN_IN_COOKIE_FIELD,
  REFRESH_TOKEN_RESPONSE_FIELD,
  SECOND_IN_MILLISECONDS,
} from '@/constants';
import { AuthError } from './auth-error';

/** The minimal request/response surface used here (works with Express and Fastify). */
interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
}
interface HttpResponseLike {
  append?: (name: string, value: string) => void;
  header: (name: string, value: string) => void;
}

/**
 * Marks the library's own controllers, so the refresh-token-cookie interceptor never touches the app's routes.
 *
 * @returns A class decorator.
 */
export const LibraryController = () => SetMetadata(METADATA_KEY.libraryController, true);

/**
 * Marks a route (logout) after which the browser should forget the refresh token cookie.
 *
 * @returns A method decorator.
 */
export const ClearsRefreshTokenCookie = () => SetMetadata(METADATA_KEY.clearsRefreshTokenCookie, true);

/**
 * Builds the Set-Cookie value for the refresh token:
 * "name=value; Max-Age=...; Path=/; HttpOnly; Secure; SameSite=Strict"
 *
 * @param options - The app's cookie settings (name, path, domain, sameSite).
 * @param value - The refresh token, or "" when deleting the cookie.
 * @param maxAgeSeconds - How long the browser should keep it; 0 deletes the cookie.
 * @returns The cookie string for the Set-Cookie header.
 */
export function buildRefreshCookie(options: RefreshTokenCookieOptions, value: string, maxAgeSeconds: number): string {
  const parts = [
    `${cookieName(options)}${COOKIE_NAME_VALUE_SEPARATOR}${encodeURIComponent(value)}`,
    `${COOKIE_ATTRIBUTE.maxAge}${COOKIE_NAME_VALUE_SEPARATOR}${Math.max(Math.floor(maxAgeSeconds), 0)}`,
    `${COOKIE_ATTRIBUTE.path}${COOKIE_NAME_VALUE_SEPARATOR}${options.path ?? REFRESH_TOKEN_COOKIE_DEFAULTS.path}`,
    ...(options.domain ? [`${COOKIE_ATTRIBUTE.domain}${COOKIE_NAME_VALUE_SEPARATOR}${options.domain}`] : []),
    `${COOKIE_ATTRIBUTE.sameSite}${COOKIE_NAME_VALUE_SEPARATOR}${options.sameSite ?? REFRESH_TOKEN_COOKIE_DEFAULTS.sameSite}`,
    COOKIE_ATTRIBUTE.httpOnly,
    COOKIE_ATTRIBUTE.secure,
  ];
  return parts.join(COOKIE_ATTRIBUTE_SEPARATOR);
}

/**
 * Reads the refresh token from the request's Cookie header.
 *
 * @param options - The app's cookie settings (to know the cookie's name).
 * @param request - The incoming request.
 * @returns The refresh token, or undefined if the cookie is missing or malformed.
 */
export function readRefreshCookie(options: RefreshTokenCookieOptions, request: HttpRequestLike): string | undefined {
  const header = request.headers[HTTP_HEADER.cookie];
  const cookieHeader = Array.isArray(header) ? header.join(COOKIE_PAIR_SEPARATOR) : header;
  if (!cookieHeader) return undefined;
  const wantedName = cookieName(options);
  for (const pair of cookieHeader.split(COOKIE_PAIR_SEPARATOR)) {
    const separatorIndex = pair.indexOf(COOKIE_NAME_VALUE_SEPARATOR);
    if (separatorIndex > 0 && pair.slice(0, separatorIndex).trim() === wantedName) {
      try {
        return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Cross-site request protection for cookie refreshes: the browser always sends the Origin header
 * on these requests, and it must be one of the app's own websites.
 *
 * @param options - The app's cookie settings, including `allowedOrigins`.
 * @param request - The incoming request.
 * @throws AuthError FORBIDDEN when the origin is missing or not in the list.
 */
export function assertAllowedOrigin(options: RefreshTokenCookieOptions, request: HttpRequestLike): void {
  if (!isAllowedOrigin(options, request)) throw new AuthError(AUTH_ERRORS.originNotAllowed);
}

/**
 * @param options - The app's cookie settings.
 * @returns The configured cookie name, or the default one.
 */
function cookieName(options: RefreshTokenCookieOptions): string {
  return options.name ?? REFRESH_TOKEN_COOKIE_DEFAULTS.name;
}

/**
 * Adds a Set-Cookie header without removing cookies that other code has already set.
 *
 * @param response - The Express or Fastify response.
 * @param cookie - The full cookie string from `buildRefreshCookie`.
 */
function setCookieHeader(response: HttpResponseLike, cookie: string) {
  // Express: append() keeps cookies set by other code. Fastify: header() appends Set-Cookie itself.
  if (typeof response.append === 'function') response.append(HTTP_HEADER.setCookie, cookie);
  else response.header(HTTP_HEADER.setCookie, cookie);
}

/**
 * Checks whether the request comes from one of the web app's own origins (browsers send Origin).
 *
 * @param options - The app's cookie settings, including `allowedOrigins`.
 * @param request - The incoming request.
 * @returns True when the Origin header is in the allowed list.
 */
export function isAllowedOrigin(options: RefreshTokenCookieOptions, request: HttpRequestLike): boolean {
  const origin = request.headers[HTTP_HEADER.origin];
  return typeof origin === 'string' && options.allowedOrigins.includes(origin);
}

/**
 * Active only when AuthOptions.refreshTokenCookie is set, and only for requests from the allowed
 * web origins, so mobile apps and servers on the same API keep getting the token in the body.
 * On the library's routes:
 * - a response carrying a refresh token: the token moves into the HttpOnly cookie and the body
 *   says `refreshTokenInCookie: true` instead,
 * - routes marked @ClearsRefreshTokenCookie() (logout): the cookie is deleted.
 */
@Injectable()
export class RefreshTokenCookieInterceptor implements NestInterceptor {
  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) private readonly options: AuthOptions,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Moves the refresh token from the response body into the cookie (or clears the cookie on logout).
   * Requests that don't qualify pass through untouched.
   *
   * @param context - Nest's view of the current request.
   * @param next - The route handler.
   * @returns The response body, with `refreshToken` replaced by `refreshTokenInCookie: true` when it was moved.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const cookieOptions = this.options.refreshTokenCookie;
    if (!cookieOptions || context.getType() !== HTTP_CONTEXT_TYPE) return next.handle();
    if (this.reflector.get<boolean>(METADATA_KEY.libraryController, context.getClass()) !== true) return next.handle();
    if (!isAllowedOrigin(cookieOptions, context.switchToHttp().getRequest<HttpRequestLike>())) return next.handle();
    const response = context.switchToHttp().getResponse<HttpResponseLike>();
    const clearsCookie = this.reflector.get<boolean>(METADATA_KEY.clearsRefreshTokenCookie, context.getHandler()) === true;

    return next.handle().pipe(
      map((body: unknown) => {
        if (clearsCookie) {
          setCookieHeader(response, buildRefreshCookie(cookieOptions, '', 0));
          return body;
        }
        if (!body || typeof body !== 'object') return body;
        const { [REFRESH_TOKEN_RESPONSE_FIELD]: refreshToken, ...rest } = body as Record<string, unknown>;
        if (typeof refreshToken !== 'string') return body;
        const expiresAt = Date.parse(String(rest[REFRESH_TOKEN_EXPIRES_AT_RESPONSE_FIELD]));
        const maxAgeSeconds = Number.isNaN(expiresAt) ? 0 : (expiresAt - Date.now()) / SECOND_IN_MILLISECONDS;
        setCookieHeader(response, buildRefreshCookie(cookieOptions, refreshToken, maxAgeSeconds));
        return { ...rest, [REFRESH_TOKEN_IN_COOKIE_FIELD]: true };
      }),
    );
  }
}
