import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// 全局模块：所有业务模块直接注入 PrismaService
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
