import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DEFAULT_PORT, ORIGIN_LIST_SEPARATOR, TRUST_PROXY_SETTING, TRUSTED_PROXY_HOPS } from './app.constants';

async function startServer() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind a load balancer (AWS ALB, Nginx): trust ONE proxy hop so request.ip is the real
  // client IP. Rate limits and the device list depend on it.
  app.set(TRUST_PROXY_SETTING, TRUSTED_PROXY_HOPS);

  // Your web app's address(es). Mobile apps don't need CORS.
  app.enableCors({ origin: process.env.WEB_APP_ORIGIN?.split(ORIGIN_LIST_SEPARATOR) ?? [], credentials: false });

  await app.listen(Number(process.env.PORT ?? DEFAULT_PORT));
}

void startServer();
