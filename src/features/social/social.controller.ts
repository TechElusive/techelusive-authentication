import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, UsePipes } from '@nestjs/common';
import { AuthError } from '@/common/auth-error';
import { strictValidationPipe } from '@/common/strict-validation.pipe';
import { CurrentRequest, RequestContext } from '@/common/request-context';
import { AUTH_ERRORS, ROUTES, ROUTE_PARAM, SOCIAL_PROVIDERS } from '@/constants';
import { SocialProvider } from '@/database/entities';
import { CheckSession, CurrentUserId, Public } from '@/guards/auth.decorators';
import { SocialAuthService } from './social-auth.service';
import { SocialSignInInput } from './social.dto';
import { LibraryController } from '@/common/refresh-token-cookie';

/**
 * Google, Apple and Facebook.
 *
 *   POST   /auth/social/:provider        sign in / sign up with the provider's token
 *   POST   /auth/social/:provider/link   signed in: connect the provider to this account
 *   DELETE /auth/social/:provider        signed in: disconnect it
 *
 * :provider is "google", "apple" or "facebook".
 */
@Controller(ROUTES.social.prefix)
@LibraryController()
@UsePipes(strictValidationPipe)
export class SocialController {
  constructor(private readonly socialAuth: SocialAuthService) {}

  /**
   * POST /auth/social/:provider — Signs in or signs up with the provider's token. Public.
   *
   * @param provider - From the URL.
   * @param body - `{ token, nonce? }`, plus sign-up details for new accounts.
   * @param request - Who is asking.
   * @returns Tokens, or a 2FA challenge.
   */
  @Post(ROUTES.social.signIn)
  @Public()
  @HttpCode(HttpStatus.OK)
  signIn(@Param(ROUTE_PARAM.provider) provider: string, @Body() body: SocialSignInInput, @CurrentRequest() request: RequestContext) {
    return this.socialAuth.signInWithProvider(this.parseProvider(provider), body, request);
  }

  /**
   * POST /auth/social/:provider/link — Connects the provider to the signed-in account.
   *
   * @param userId - From the access token.
   * @param provider - From the URL.
   * @param body - `{ token, nonce? }`.
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Post(ROUTES.social.link)
  @CheckSession()
  @HttpCode(HttpStatus.OK)
  link(
    @CurrentUserId() userId: string,
    @Param(ROUTE_PARAM.provider) provider: string,
    @Body() body: SocialSignInInput,
    @CurrentRequest() request: RequestContext,
  ) {
    return this.socialAuth.linkProvider(userId, this.parseProvider(provider), body, request);
  }

  /**
   * DELETE /auth/social/:provider — Disconnects the provider.
   *
   * @param userId - From the access token.
   * @param provider - From the URL.
   * @param request - Who is asking.
   * @returns `{ success: true }`.
   */
  @Delete(ROUTES.social.unlink)
  @CheckSession()
  unlink(@CurrentUserId() userId: string, @Param(ROUTE_PARAM.provider) provider: string, @CurrentRequest() request: RequestContext) {
    return this.socialAuth.unlinkProvider(userId, this.parseProvider(provider), request);
  }

  /**
   * @param provider - The :provider part of the URL.
   * @returns The provider name, now known to be supported.
   * @throws AuthError NOT_FOUND for any other value.
   */
  private parseProvider(provider: string): SocialProvider {
    if (!(SOCIAL_PROVIDERS as readonly string[]).includes(provider)) throw new AuthError(AUTH_ERRORS.notFound);
    return provider as SocialProvider;
  }
}
