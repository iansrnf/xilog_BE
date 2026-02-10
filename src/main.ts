import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const port = Number(process.env.PORT ?? 3001);
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`WS backend running on ws://0.0.0.0:${port}`);
}
bootstrap();
