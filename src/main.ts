import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.useWebSocketAdapter(new WsAdapter(app));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`HTTP listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Device WS: ws://localhost:${port}/device`);
  // eslint-disable-next-line no-console
  console.log(`Stream WS: ws://localhost:${port}/stream`);
}

bootstrap();
