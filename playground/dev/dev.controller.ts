import { Body, Controller, Get, Header, HttpCode, HttpStatus, Inject, NotFoundException, Post, Query, RawBodyRequest, Req } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { ApiKeyScopes, AuthenticatedCaller, AuthOptions, CurrentCaller, Public, SettingsService, SYSTEM_REQUEST, UsersService, verifyWebhookSignature, WebhooksService } from '@/index';
import { timeStepAt, totpCodeForTimeStep } from '@/common/crypto/totp';
import { currentUnixTimeSeconds } from '@/common/time';
import { AUTH_OPTIONS_TOKEN } from '@/constants';
import { WebhookDeliveryEntity, WebhookEntity } from '@/database/entities';
import {
  DEV_ROUTES,
  HTML_CONTENT_TYPE,
  PLAYGROUND_ADMIN_ROLE,
  PLAYGROUND_FILES,
  REPOSITORY_MARKER_FILE,
  SAMPLE_API_KEY_SCOPE,
  SAMPLE_APP_ROUTES,
  SWAGGER_CDN_PLACEHOLDER,
  SWAGGER_ROUTES,
  SWAGGER_SPEC_URL_PLACEHOLDER,
  SWAGGER_UI_CDN,
  WEBHOOK_DELIVERY_HEADER_NAME,
  WEBHOOK_SIGNATURE_HEADER_NAME,
  CONTENT_TYPE_HEADER,
} from '../playground.constants';
import { devInbox } from './dev-inbox';

/** The repository root, found by walking up from the compiled file to package.json. */
function findRepositoryRoot(): string {
  let folder = __dirname;
  while (!existsSync(join(folder, REPOSITORY_MARKER_FILE))) folder = dirname(folder);
  return folder;
}
const REPOSITORY_ROOT = findRepositoryRoot();
const readRepositoryFile = (relativePath: string) => readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8');

/**
 * Developer tools for manual testing. Only the playground registers this controller; it is never
 * part of the library, so it can't end up in a real app.
 */
@Controller(DEV_ROUTES.prefix)
@Public()
export class DevController {
  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) private readonly options: AuthOptions,
    private readonly users: UsersService,
    private readonly webhooks: WebhooksService,
    private readonly settings: SettingsService,
  ) {}

  /** The dashboard: inbox, live events, webhook receiver and a small test client. */
  @Get(DEV_ROUTES.dashboard)
  @Header(CONTENT_TYPE_HEADER, HTML_CONTENT_TYPE)
  dashboard() {
    return readRepositoryFile(PLAYGROUND_FILES.dashboard);
  }

  @Get(DEV_ROUTES.inbox)
  inbox() {
    return { messages: devInbox.messages };
  }

  /** Used by Postman: the newest message of a type sent to an address. 404 when there is none. */
  @Get(DEV_ROUTES.latestMessage)
  latestMessage(@Query('to') to = '', @Query('type') type = '') {
    const message = devInbox.findLatest(to, type);
    if (!message) throw new NotFoundException();
    return message;
  }

  @Get(DEV_ROUTES.events)
  events() {
    return { events: devInbox.events };
  }

  @Get(DEV_ROUTES.webhookDeliveries)
  webhookDeliveries() {
    return { deliveries: devInbox.webhooks };
  }

  /** The current authenticator-app code for a secret, so Postman can test 2FA without a phone. */
  @Get(DEV_ROUTES.totp)
  totp(@Query('secret') secret = '') {
    if (!secret) throw new NotFoundException();
    return { code: totpCodeForTimeStep(secret, timeStepAt(currentUnixTimeSeconds())) };
  }

  /** Gives a user the admin role. Sign in again afterwards: roles are read into new tokens. */
  @Post(DEV_ROUTES.makeAdmin)
  @HttpCode(HttpStatus.OK)
  async makeAdmin(@Body() body: { email?: string }) {
    const user = await this.users.findUserByEmail(String(body.email ?? '').trim().toLowerCase());
    if (!user) throw new NotFoundException();
    const roles = [...new Set([...user.roles, ...(await this.settings.getSettings()).admin.adminRoles, PLAYGROUND_ADMIN_ROLE])];
    await this.users.setRoles(user.id, roles, user.id, SYSTEM_REQUEST);
    return { success: true, roles };
  }

  /** Settings the dashboard needs (e.g. whether to show the Google button). */
  @Get(DEV_ROUTES.config)
  async config() {
    const settings = await this.settings.getSettings();
    return {
      googleClientId: settings.google.enabled ? settings.google.clientIds[0] : null,
      passkeysEnabled: settings.passkeys.enabled,
    };
  }

  @Post(DEV_ROUTES.clear)
  @HttpCode(HttpStatus.OK)
  clear() {
    devInbox.clear();
    return { success: true };
  }

  /**
   * A webhook endpoint for testing deliveries end to end. It looks up the webhook's secret itself
   * (a real receiver would have it in its configuration) and checks the signature.
   */
  @Post(DEV_ROUTES.webhookReceiver)
  @HttpCode(HttpStatus.NO_CONTENT)
  async receiveWebhook(@Req() request: RawBodyRequest<{ headers: Record<string, string | undefined>; body: unknown }>) {
    const rawBody = request.rawBody?.toString() ?? '';
    const deliveryId = request.headers[WEBHOOK_DELIVERY_HEADER_NAME];
    const delivery = deliveryId
      ? await this.options.dataSource.getRepository(WebhookDeliveryEntity).findOne({ where: { id: deliveryId } })
      : null;
    const webhook = delivery
      ? await this.options.dataSource.getRepository(WebhookEntity).findOne({ where: { id: delivery.webhookId } })
      : null;
    const secret = webhook ? await this.webhooks.decryptSigningSecret(webhook) : '';
    devInbox.recordWebhook({
      eventName: (request.body as { name?: string } | undefined)?.name,
      isSignatureValid: verifyWebhookSignature(secret, rawBody, request.headers[WEBHOOK_SIGNATURE_HEADER_NAME]),
      body: request.body,
    });
  }
}

/** Stands in for a route of your own app, to test API keys (send the "x-api-key" header). */
@Controller(SAMPLE_APP_ROUTES.prefix)
export class SampleAppController {
  @Get(SAMPLE_APP_ROUTES.partnerExport)
  @ApiKeyScopes(SAMPLE_API_KEY_SCOPE)
  partnerExport(@CurrentCaller() caller: AuthenticatedCaller | undefined) {
    return { success: true, calledBy: caller?.apiKey ?? caller?.user ?? null };
  }
}

/** Swagger UI for the library's OpenAPI spec. */
@Controller(SWAGGER_ROUTES.prefix)
@Public()
export class SwaggerController {
  @Get(SWAGGER_ROUTES.page)
  @Header(CONTENT_TYPE_HEADER, HTML_CONTENT_TYPE)
  page() {
    return readRepositoryFile(PLAYGROUND_FILES.swagger)
      .replaceAll(SWAGGER_CDN_PLACEHOLDER, SWAGGER_UI_CDN)
      .replaceAll(SWAGGER_SPEC_URL_PLACEHOLDER, `/${SWAGGER_ROUTES.prefix}/${SWAGGER_ROUTES.spec}`);
  }

  @Get(SWAGGER_ROUTES.spec)
  spec() {
    return JSON.parse(readRepositoryFile(PLAYGROUND_FILES.openApiSpec));
  }
}
