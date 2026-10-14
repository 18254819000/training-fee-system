import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import configuration from './config/configuration';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { CaseMiddleware } from './common/middleware/case.middleware';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { RedisModule } from './common/redis/redis.module';
import { RateLimitModule } from './common/ratelimit/rate-limit.module';
import { IdModule } from './common/id/id.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { GuardsModule } from './common/guards/guards.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CampusModule } from './modules/campus/campus.module';
import { FeePeriodModule } from './modules/fee-period/fee-period.module';
import { StudentModule } from './modules/student/student.module';
import { LoginCodeModule } from './modules/login-code/login-code.module';
import { CourseModule } from './modules/course/course.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { WechatPayModule } from './modules/wechat-pay/wechat-pay.module';
import { RefundModule } from './modules/refund/refund.module';
import { ReportModule } from './modules/report/report.module';
import { PaymentAccountModule } from './modules/payment-account/payment-account.module';
import { AdminUserModule } from './modules/admin-user/admin-user.module';
import { StudentPortalModule } from './modules/student-portal/student-portal.module';
import { SystemModule } from './modules/system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-only-jwt-secret-change-me',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '8h' } as any,
    }),
    // 基础设施
    PrismaModule,
    CryptoModule,
    RedisModule,
    RateLimitModule,
    IdModule,
    IdempotencyModule,
    GuardsModule,
    // 业务模块
    AuditModule,
    AuthModule,
    CampusModule,
    FeePeriodModule,
    StudentModule,
    LoginCodeModule,
    CourseModule,
    InvoiceModule,
    WechatPayModule,
    RefundModule,
    ReportModule,
    PaymentAccountModule,
    AdminUserModule,
    StudentPortalModule,
    SystemModule,
  ],
  providers: [RequestIdMiddleware, CaseMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // CaseMiddleware 必须走 MiddlewareConsumer（在 body 解析后执行），
    // 直接 app.use() 会跑在 body 解析器之前导致 req.body 为 undefined
    consumer
      .apply(CaseMiddleware)
      .exclude({ path: 'api/v1/payments/wechat/(.*)', method: RequestMethod.ALL })
      .forRoutes('*');
  }
}
