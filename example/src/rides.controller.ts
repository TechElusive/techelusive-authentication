import { Controller, Get, Post } from '@nestjs/common';
import { AccessTokenClaims, ApiKeyScopes, CheckSession, CurrentUser, CurrentUserId, Public, Roles } from '@techelusive/nest-auth';
import { API_KEY_SCOPE, APP_ROLE, PAYOUT_STATUS, RIDES_ROUTES } from './app.constants';

/**
 * How an app protects its OWN routes. Every route is protected by default.
 */
@Controller(RIDES_ROUTES.prefix)
export class RidesController {
  /** Anyone, signed in or not. */
  @Get(RIDES_ROUTES.popular)
  @Public()
  listPopularRides() {
    return { rides: [] };
  }

  /** Any signed-in user. @CurrentUser() gives the token claims. */
  @Get(RIDES_ROUTES.mine)
  listMyRides(@CurrentUser() user: AccessTokenClaims) {
    return { userId: user.sub, rides: [] };
  }

  /** Only trip hosts (or admins). */
  @Post()
  @Roles(APP_ROLE.tripHost, APP_ROLE.admin)
  createRide(@CurrentUserId() hostUserId: string) {
    return { createdBy: hostUserId };
  }

  /** Sensitive: re-check in the database that the session wasn't signed out a moment ago. */
  @Post(RIDES_ROUTES.payout)
  @CheckSession()
  requestPayout(@CurrentUserId() userId: string) {
    return { userId, status: PAYOUT_STATUS.requested };
  }

  /** Another server (e.g. a partner) can call this with an "x-api-key" that has the "rides:read" scope. */
  @Get(RIDES_ROUTES.export)
  @ApiKeyScopes(API_KEY_SCOPE.ridesRead)
  exportRides() {
    return { rides: [] };
  }
}
