import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { CreateFeePeriodDto, UpdateFeePeriodDto } from './dto/fee-period.dto';

const NEXT_STATUS: Record<string, string[]> = {
  draft: ['open'],
  open: ['closed'],
  closed: [],
};

@Injectable()
export class FeePeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CampusScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AdminUserInfo, query: PaginationDto & { status?: string }) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const scopeFilter = this.scope.scopeFilter(user);
    const where: any = {};
    if (query.status) where.status = query.status;
    if (scopeFilter) {
      // 校区管理员只看到覆盖其校区的收费期（或全校区开放的收费期）
      where.OR = [
        { fee_period_campuses: { some: { campus_id: { in: scopeFilter.in } } } },
        { fee_period_campuses: { none: {} } },
      ];
    }
    const [total, items] = await Promise.all([
      this.prisma.feePeriod.count({ where }),
      this.prisma.feePeriod.findMany({
        where,
        include: { fee_period_campuses: { include: { campus: true } } },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return paginate(items, total, page, pageSize);
  }

  async get(user: AdminUserInfo, id: string) {
    const period = await this.prisma.feePeriod.findUnique({
      where: { id },
      include: { fee_period_campuses: { include: { campus: true } } },
    });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    // 校区范围校验：至少覆盖用户一个校区，或全校区开放
    const scopeFilter = this.scope.scopeFilter(user);
    if (scopeFilter) {
      const covered = period.fee_period_campuses.map((c) => c.campus_id);
      const visible = covered.length === 0 || covered.some((c) => scopeFilter.in.includes(c));
      if (!visible) {
        throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
      }
    }
    return period;
  }

  async create(user: AdminUserInfo, dto: CreateFeePeriodDto, requestId: string, ip: string) {
    if (new Date(dto.end_date) < new Date(dto.start_date)) {
      throw new BadRequestException({ code: 'ERR_INVALID_DATE', message: '结束日期不得早于开始日期' });
    }
    const exists = await this.prisma.feePeriod.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException({ code: 'ERR_DUPLICATE_CODE', message: '收费期编码已存在' });

    if (dto.campus_ids?.length) {
      const campuses = await this.prisma.campus.findMany({ where: { id: { in: dto.campus_ids } } });
      if (campuses.length !== dto.campus_ids.length) {
        throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '适用校区中存在无效校区' });
      }
      for (const c of campuses) this.scope.assertCampus(user, c.id, '校区');
    }

    const period = await this.prisma.feePeriod.create({
      data: {
        code: dto.code,
        name: dto.name,
        start_date: new Date(dto.start_date),
        end_date: new Date(dto.end_date),
        created_by: user.id,
        fee_period_campuses: dto.campus_ids?.length
          ? { create: dto.campus_ids.map((campus_id) => ({ campus_id })) }
          : undefined,
      },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'fee-period.create', resourceType: 'fee_period',
      resourceId: period.id, result: 'success', requestId, ip, metadata: { code: period.code },
    });
    return period;
  }

  async update(user: AdminUserInfo, id: string, dto: UpdateFeePeriodDto, requestId: string, ip: string) {
    const period = await this.prisma.feePeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });

    if (dto.status && dto.status !== period.status) {
      if (!NEXT_STATUS[period.status].includes(dto.status)) {
        throw new BadRequestException({
          code: 'ERR_INVALID_STATUS_TRANSITION',
          message: `收费期状态只允许单向流转：draft→open→closed，当前为 ${period.status}`,
        });
      }
    }
    const start = dto.start_date ? new Date(dto.start_date) : period.start_date;
    const end = dto.end_date ? new Date(dto.end_date) : period.end_date;
    if (end < start) {
      throw new BadRequestException({ code: 'ERR_INVALID_DATE', message: '结束日期不得早于开始日期' });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.campus_ids) {
        await tx.feePeriodCampus.deleteMany({ where: { fee_period_id: id } });
        if (dto.campus_ids.length > 0) {
          await tx.feePeriodCampus.createMany({
            data: dto.campus_ids.map((campus_id) => ({ fee_period_id: id, campus_id })),
          });
        }
      }
      return tx.feePeriod.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.start_date ? { start_date: new Date(dto.start_date) } : {}),
          ...(dto.end_date ? { end_date: new Date(dto.end_date) } : {}),
          ...(dto.status ? { status: dto.status } : {}),
        },
      });
    });

    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'fee-period.update', resourceType: 'fee_period',
      resourceId: id, result: 'success', requestId, ip, metadata: { changes: dto },
    });
    return updated;
  }

  /** 账单生成前调用：收费期必须为 open 且覆盖该校区 */
  async requireOpenForCampus(feePeriodId: string, campusId: string) {
    const period = await this.prisma.feePeriod.findUnique({
      where: { id: feePeriodId },
      include: { fee_period_campuses: true },
    });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    if (period.status !== 'open') {
      throw new BadRequestException({ code: 'ERR_PERIOD_NOT_OPEN', message: '收费期未开放，禁止生成新账单' });
    }
    const covered = period.fee_period_campuses.map((c) => c.campus_id);
    if (covered.length > 0 && !covered.includes(campusId)) {
      throw new BadRequestException({ code: 'ERR_PERIOD_CAMPUS_MISMATCH', message: '该收费期不适用于此校区' });
    }
    return period;
  }
}
