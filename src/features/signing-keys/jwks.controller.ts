import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '@/guards/auth.decorators';
import { SigningKeysService } from './signing-keys.service';
import { HTTP_HEADER, JWKS_CACHE_CONTROL, ROUTES } from '@/constants';
import { LibraryController } from '@/common/refresh-token-cookie';

/**
 * Publishes the public keys that verify access tokens. Your other services (any language) can check
 * tokens with a standard JWT library pointed at GET /.well-known/jwks.json.
 */
@Controller(ROUTES.wellKnown.prefix)
@LibraryController()
@Public()
export class JwksController {
  constructor(private readonly signingKeys: SigningKeysService) {}

  /**
   * GET /.well-known/jwks.json — The public keys that verify access tokens. Public; may be cached for 5 minutes.
   *
   * @returns `{ keys: [...] }` in standard JWKS format.
   */
  @Get(ROUTES.wellKnown.jwks)
  @Header(HTTP_HEADER.cacheControl, JWKS_CACHE_CONTROL)
  async getPublicKeys() {
    const { publicJwks } = await this.signingKeys.getSigningKeys();
    return { keys: publicJwks };
  }
}
