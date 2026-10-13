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

// 收费期：只绑定单个校区（campus_id 必填）
// 账单生成链路：校区 → 收费期 → 收费项目
@Injectable()
export class FeePeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CampusScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AdminUserInfo, query: PaginationDto & { status?: string; campus_id?: string }) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const scopeFilter = this.scope.scopeFilter(user);
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.campus_id) {
      this.scope.assertCampus(user, query.campus_id, '校区');
      where.campus_id = query.campus_id;
    } else if (scopeFilter) {
      where.campus_id = scopeFilter;
    }
    const [total, items] = await Promise.all([
      this.prisma.feePeriod.count({ where }),
      this.prisma.feePeriod.findMany({
        where,
        include: { campus: { select: { id: true, code: true, name: true } } },
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
      include: { campus: { select: { id: true, code: true, name: true } } },
    });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    this.scope.assertCampus(user, period.campus_id, '收费期');
    return period;
  }

  async create(user: AdminUserInfo, dto: CreateFeePeriodDto, requestId: string, ip: string) {
    if (new Date(dto.end_date) < new Date(dto.start_date)) {
      throw new BadRequestException({ code: 'ERR_INVALID_DATE', message: '结束日期不得早于开始日期' });
    }
    const exists = await this.prisma.feePeriod.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException({ code: 'ERR_DUPLICATE_CODE', message: '收费期编码已存在' });

    const campus = await this.prisma.campus.findUnique({ where: { id: dto.campus_id } });
    if (!campus || campus.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '所属校区无效或已停用' });
    }
    this.scope.assertCampus(user, campus.id, '校区');

    const period = await this.prisma.feePeriod.create({
      data: {
        code: dto.code,
        name: dto.name,
        campus_id: campus.id,
        start_date: new Date(dto.start_date),
        end_date: new Date(dto.end_date),
        created_by: user.id,
      },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'fee-period.create', resourceType: 'fee_period',
      resourceId: period.id, result: 'success', requestId, ip, metadata: { code: period.code, campus_id: campus.id },
    });
    return period;
  }

  async update(user: AdminUserInfo, id: string, dto: UpdateFeePeriodDto, requestId: string, ip: string) {
    const period = await this.prisma.feePeriod.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true, fee_item_periods: true } } },
    });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    this.scope.assertCampus(user, period.campus_id, '收费期');

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

    // 变更所属校区：仅允许在无账单且无收费项目绑定时
    let newCampusId: string | undefined;
    if (dto.campus_id && dto.campus_id !== period.campus_id) {
      if (period._count.invoices > 0) {
        throw new BadRequestException({ code: 'ERR_PERIOD_HAS_INVOICES', message: '该收费期已有账单，不可变更所属校区' });
      }
      if (period._count.fee_item_periods > 0) {
        throw new BadRequestException({ code: 'ERR_PERIOD_HAS_ITEMS', message: '该收费期已绑定收费项目，请先解绑后再变更所属校区' });
      }
      const campus = await this.prisma.campus.findUnique({ where: { id: dto.campus_id } });
      if (!campus || campus.status !== 'active') {
        throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '所属校区无效或已停用' });
      }
      this.scope.assertCampus(user, campus.id, '校区');
      newCampusId = campus.id;
    }

    const updated = await this.prisma.feePeriod.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.start_date ? { start_date: new Date(dto.start_date) } : {}),
        ...(dto.end_date ? { end_date: new Date(dto.end_date) } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(newCampusId ? { campus_id: newCampusId } : {}),
      },
    });

    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'fee-period.update', resourceType: 'fee_period',
      resourceId: id, result: 'success', requestId, ip, metadata: { changes: dto },
    });
    return updated;
  }

  /** 删除收费期：已有账单时禁止删除（绑定关系随收费期级联删除） */
  async remove(user: AdminUserInfo, id: string, requestId: string, ip: string) {
    const period = await this.prisma.feePeriod.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } },
    });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    this.scope.assertCampus(user, period.campus_id, '收费期');
    if (period._count.invoices > 0) {
      throw new BadRequestException({ code: 'ERR_PERIOD_HAS_INVOICES', message: '该收费期已有账单，不可删除' });
    }
    await this.prisma.feePeriod.delete({ where: { id } });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'fee-period.delete', resourceType: 'fee_period',
      resourceId: id, result: 'success', requestId, ip, metadata: { code: period.code },
    });
    return { id };
  }

  /** 账单生成用：查询某收费期绑定的收费项目（仅启用） */
  async listBoundFeeItems(user: AdminUserInfo, id: string) {
    const period = await this.prisma.feePeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    this.scope.assertCampus(user, period.campus_id, '收费期');
    const rows = await this.prisma.feeItemPeriod.findMany({
      where: { fee_period_id: id, fee_item: { status: 'active' } },
      include: {
        fee_item: {
          select: { id: true, code: true, name: true, amount_fen: true, campus_id: true, status: true },
        },
      },
      orderBy: { fee_item: { code: 'asc' } },
    });
    return rows.map((r) => r.fee_item);
  }

  /** 账单生成前调用：收费期必须为 open 且属于该校区 */
  async requireOpenForCampus(feePeriodId: string, campusId: string) {
    const period = await this.prisma.feePeriod.findUnique({ where: { id: feePeriodId } });
    if (!period) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费期不存在' });
    if (period.status !== 'open') {
      throw new BadRequestException({ code: 'ERR_PERIOD_NOT_OPEN', message: '收费期未开放，禁止生成新账单' });
    }
    if (period.campus_id !== campusId) {
      throw new BadRequestException({ code: 'ERR_PERIOD_CAMPUS_MISMATCH', message: '该收费期不属于所选校区' });
    }
    return period;
  }
}
