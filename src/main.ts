import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── CORS ──────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── GLOBAL VALIDATION PIPE ────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── GLOBAL EXCEPTION FILTER ───────────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ── SWAGGER ───────────────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('KIA Dealer Management API')
    .setDescription(
      'API para la gestión de vehículos, órdenes de servicio, documentación, entregas y usuarios del sistema KIA Dealer.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 KIA Dealer API running at http://localhost:${port}/api`);
}

bootstrap();
