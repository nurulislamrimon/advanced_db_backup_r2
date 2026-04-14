import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  const server = app.getHttpServer();
  const shutdown = async () => {
    console.log('Shutdown signal received, closing server...');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen(3000);
  console.log('Application started on port 3000');
}

bootstrap();