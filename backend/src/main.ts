import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

// 应用入口
async function bootstrap() {
  // rawBody: true —— 微信支付通知验签需要原始报文，不能用解析后的 JSON
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const logger = new Logger('Bootstrap');

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean), credentials: true });

  // 全局前缀：所有接口 /api/v1/...
  app.setGlobalPrefix('api/v1');

  // 请求追踪 ID 中间件（最先执行；仅碰 headers，可用 app.use）
  const requestIdMiddleware = app.get(RequestIdMiddleware);
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));
  // CaseMiddleware 已改走 AppModule 的 MiddlewareConsumer（body 解析后执行），此处不再 app.use

  // 全局校验：DTO 白名单 + 自动转型
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
  );
  // 统一错误格式 { code, message, requestId }
  app.useGlobalFilters(new HttpExceptionFilter());
  // 出参转换：snake_case → camelCase，BigInt → Number
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger（非生产环境）
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('培训学校多校区收费系统 API')
      .setDescription('一期 MVP：REST /api/v1')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, doc);
    logger.log('Swagger: /api/docs');
  }

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  logger.log(`API listening on :${port} (prefix /api/v1)`);
}
bootstrap();
