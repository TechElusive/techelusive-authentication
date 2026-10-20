import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PRODUCTION_ENVIRONMENT } from '@/constants';
import { PlaygroundModule } from './playground.module';
import { existsSync } from 'node:fs';
import { DEV_ROUTES, PLAYGROUND_ENV_FILE, PLAYGROUND_LOG_CONTEXT, PLAYGROUND_PORT, PLAYGROUND_URL, SWAGGER_ROUTES } from './playground.constants';

async function startPlayground() {
  // Settings from playground/.env, if present. Variables already set in the shell win.
  if (existsSync(PLAYGROUND_ENV_FILE)) process.loadEnvFile(PLAYGROUND_ENV_FILE);
  if (process.env.NODE_ENV === PRODUCTION_ENVIRONMENT) {
    throw new Error('The playground is for local testing only and refuses to run with NODE_ENV=production.');
  }
  // rawBody: the webhook receiver needs the exact bytes to check signatures.
  const app = await NestFactory.create(PlaygroundModule, { rawBody: true });
  await app.listen(PLAYGROUND_PORT);

  const logger = new Logger(PLAYGROUND_LOG_CONTEXT);
  logger.log(`Dev dashboard:  ${PLAYGROUND_URL}/${DEV_ROUTES.prefix}`);
  logger.log(`Swagger UI:     ${PLAYGROUND_URL}/${SWAGGER_ROUTES.prefix}`);
  logger.log(`Postman:        import api/techelusive-authentication.postman_collection.json`);
}

void startPlayground();
