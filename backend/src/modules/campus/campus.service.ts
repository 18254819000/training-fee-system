import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { CreateCampusDto, UpdateCampusDto } from './dto/campus.dto';

@Injectable()
export class CampusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CampusScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AdminUserInfo, query: PaginationDto & { status?: string; keyword?: string }) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const scopeFilter = this.scope.scopeFilter(user);
    const where: any = {};
    if (scopeFilter) where.id = scopeFilter;
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword } },
        { code: { contains: query.keyword } },
      ];
    }
    const [total, items] = await Promise.all([
      this.prisma.campus.count({ where }),
      this.prisma.campus.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return paginate(items, total, page, pageSize);
  }

  async get(user: AdminUserInfo, id: string) {
    const campus = await this.prisma.campus.findUnique({ where: { id } });
    if (!campus) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '校区不存在' });
    this.scope.assertCampus(user, campus.id, '校区');
    return campus;
  }

  async create(user: AdminUserInfo, dto: CreateCampusDto, requestId: string, ip: string) {
    const exists = await this.prisma.campus.findUnique({ where: { code: dto.code } });
    if (exists) {
      throw new ConflictException({ code: 'ERR_DUPLICATE_CODE', message: '校区编码已存在' });
    }
    const campus = await this.prisma.campus.create({ data: { ...dto } });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'campus.create', resourceType: 'campus',
      resourceId: campus.id, result: 'success', requestId, ip, metadata: { code: campus.code, name: campus.name },
    });
    return campus;
  }

  async update(user: AdminUserInfo, id: string, dto: UpdateCampusDto, requestId: string, ip: string) {
    const campus = await this.prisma.campus.findUnique({ where: { id } });
    if (!campus) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '校区不存在' });
    this.scope.assertCampus(user, campus.id, '校区');

    if (dto.status === 'inactive') {
      // 停用不做物理删除；历史账单通过外键 Restrict 得到保护
      const invoiceCount = await this.prisma.invoice.count({ where: { campus_id: id } });
      if (invoiceCount > 0) {
        // 允许停用（历史数据保留），仅记录提示
      }
    }
    const updated = await this.prisma.campus.update({ where: { id }, data: { ...dto } });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'campus.update', resourceType: 'campus',
      resourceId: id, result: 'success', requestId, ip, metadata: { changes: dto },
    });
    return updated;
  }

  /** 校验校区编码存在且启用（导入等场景用），返回校区 */
  async requireActiveByCode(code: string) {
    const campus = await this.prisma.campus.findUnique({ where: { code } });
    if (!campus || campus.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: `校区编码无效或已停用：${code}` });
    }
    return campus;
  }
}
