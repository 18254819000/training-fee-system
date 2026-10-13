import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminJwtGuard } from './admin-jwt.guard';
import { StudentSessionGuard } from './student-session.guard';
import { RolesGuard } from './roles.guard';
import { CampusScopeService } from './campus-scope.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-only-jwt-secret-change-me',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '8h' } as any,
    }),
  ],
  providers: [AdminJwtGuard, StudentSessionGuard, RolesGuard, CampusScopeService],
  exports: [AdminJwtGuard, StudentSessionGuard, RolesGuard, CampusScopeService, JwtModule],
})
export class GuardsModule {}
