import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';
import { paginate } from '../../common/dto/pagination.dto';
import { CourseQueryDto, FeeItemQueryDto } from './dto/course.dto';
import {
  CreateCourseDto, CreateFeeItemDto,
  SetFeeItemPeriodsDto, UpdateCourseDto, UpdateFeeItemDto,
} from './dto/course.dto';

// 课程 / 收费项目服务
// 新模型：收费项目直挂单个校区与价格；编码由后台自动生成（前端隐藏）；
// 收费项目 ↔ 收费期多对多（须同校区）；学生绑定收费项目；
// 账单按 校区 → 收费期 → 收费项目 生成，金额取项目价格快照。
@Injectable()
export class CourseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly scope: CampusScopeService,
    private readonly audit: AuditService,
  ) {}

  // ─── 课程 ───

  async listCourses(query: CourseQueryDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.keyword) where.OR = [{ name: { contains: query.keyword } }, { code: { contains: query.keyword } }];
    const [total, items] = await Promise.all([
      this.prisma.course.count({ where }),
      this.prisma.course.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return paginate(items, total, page, pageSize);
  }

  async createCourse(user: AdminUserInfo, dto: CreateCourseDto, requestId: string, ip: string) {
    try {
      const course = await this.prisma.course.create({ data: { ...dto } });
      await this.audit.log({ actorType: 'admin', actorId: user.id, action: 'course.create', resourceType: 'course', resourceId: course.id, result: 'success', requestId, ip, metadata: { code: course.code } });
      return course;
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException({ code: 'ERR_DUPLICATE_CODE', message: '课程编码已存在' });
      throw e;
    }
  }

  async updateCourse(user: AdminUserInfo, id: string, dto: UpdateCourseDto, requestId: string, ip: string) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '课程不存在' });
    const updated = await this.prisma.course.update({ where: { id }, data: { ...dto } });
    await this.audit.log({ actorType: 'admin', actorId: user.id, action: 'course.update', resourceType: 'course', resourceId: id, result: 'success', requestId, ip, metadata: { changes: Object.keys(dto) } });
    return updated;
  }

  // ─── 收费项目 ───

  async listFeeItems(user: AdminUserInfo, query: FeeItemQueryDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.course_id) where.course_id = query.course_id;
    if (query.keyword) where.OR = [{ name: { contains: query.keyword } }, { code: { contains: query.keyword } }];
    const scopeFilter = this.scope.scopeFilter(user);
    if (query.campus_id) {
      this.scope.assertCampus(user, query.campus_id, '校区');
      where.campus_id = query.campus_id;
    } else if (scopeFilter) {
      where.campus_id = scopeFilter;
    }
    const [total, items] = await Promise.all([
      this.prisma.feeItem.count({ where }),
      this.prisma.feeItem.findMany({
        where,
        include: {
          course: { select: { id: true, code: true, name: true } },
          campus: { select: { id: true, code: true, name: true } },
          fee_item_periods: {
            include: { fee_period: { select: { id: true, code: true, name: true, status: true } } },
            orderBy: { fee_period: { start_date: 'desc' } },
          },
        },
        orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    const mapped = items.map((it: any) => ({
      ...it,
      /* amount_fen 由拦截器转为 Number */
      fee_periods: (it.fee_item_periods || []).map((fp: any) => fp.fee_period),
      fee_item_periods: undefined,
    }));
    return paginate(mapped, total, page, pageSize);
  }

  async createFeeItem(user: AdminUserInfo, dto: CreateFeeItemDto, requestId: string, ip: string) {
    const campus = await this.prisma.campus.findUnique({ where: { id: dto.campus_id } });
    if (!campus || campus.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '所属校区无效或已停用' });
    }
    this.scope.assertCampus(user, campus.id, '校区');
    if (dto.course_id) {
      const course = await this.prisma.course.findUnique({ where: { id: dto.course_id } });
      if (!course) throw new BadRequestException({ code: 'ERR_COURSE_INVALID', message: '关联课程不存在' });
    }
    // 绑定的收费期必须存在且属于同一校区
    const periodIds = Array.from(new Set((dto.fee_period_ids || []).filter(Boolean)));
    await this.assertPeriodsInCampus(periodIds, campus.id);

    // 收费项目编码由后台自动生成（前端隐藏，不手工输入）
    const code = await this.genUniqueFeeItemCode();
    const item = await this.prisma.feeItem.create({
      data: {
        code,
        name: dto.name,
        course_id: dto.course_id || null,
        campus_id: campus.id,
        amount_fen: BigInt(dto.amount_fen),
        description: dto.description || null,
        fee_item_periods: periodIds.length
          ? { create: periodIds.map((fee_period_id) => ({ fee_period_id })) }
          : undefined,
      },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'fee-item.create', resourceType: 'fee_item',
      resourceId: item.id, result: 'success', requestId, ip,
      metadata: { code: item.code, campus_id: campus.id, amount_fen: dto.amount_fen },
    });
    return item;
  }

  /** 生成全局唯一的收费项目编码（后台自动管理，前端隐藏） */
  private async genUniqueFeeItemCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = `FI${this.crypto.randomHex(4).toUpperCase()}`;
      const exists = await this.prisma.feeItem.findUnique({ where: { code } });
      if (!exists) return code;
    }
    // 极小概率连续碰撞时兜底：时间戳后缀
    return `FI${Date.now().toString(36).toUpperCase()}${this.crypto.randomHex(2).toUpperCase()}`;
  }

  async updateFeeItem(user: AdminUserInfo, id: string, dto: UpdateFeeItemDto, requestId: string, ip: string) {
    const item = await this.prisma.feeItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费项目不存在' });
    this.scope.assertCampus(user, item.campus_id, '校区');
    // 所属校区创建后不可变更（如需换校区请新建项目）
    const updated = await this.prisma.feeItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.amount_fen !== undefined ? { amount_fen: BigInt(dto.amount_fen) } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });
    await this.audit.log({ actorType: 'admin', actorId: user.id, action: 'fee-item.update', resourceType: 'fee_item', resourceId: id, result: 'success', requestId, ip, metadata: { changes: Object.keys(dto) } });
    return updated;
  }

  /** 删除收费项目：已有学生绑定或账单明细引用时禁止删除 */
  async deleteFeeItem(user: AdminUserInfo, id: string, requestId: string, ip: string) {
    const item = await this.prisma.feeItem.findUnique({
      where: { id },
      include: { _count: { select: { students: true, invoice_items: true } } },
    });
    if (!item) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费项目不存在' });
    this.scope.assertCampus(user, item.campus_id, '校区');
    if (item._count.students > 0) {
      throw new BadRequestException({ code: 'ERR_ITEM_HAS_STUDENTS', message: `已有 ${item._count.students} 名学生绑定该收费项目，不可删除` });
    }
    if (item._count.invoice_items > 0) {
      throw new BadRequestException({ code: 'ERR_ITEM_HAS_INVOICES', message: '该收费项目已有账单引用，不可删除' });
    }
    await this.prisma.feeItem.delete({ where: { id } });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'fee-item.delete', resourceType: 'fee_item',
      resourceId: id, result: 'success', requestId, ip, metadata: { code: item.code },
    });
    return { id };
  }

  // ─── 收费项目 ↔ 收费期绑定 ───

  /** 查询收费项目已绑定的收费期 */
  async getFeeItemPeriods(feeItemId: string) {
    const item = await this.prisma.feeItem.findUnique({ where: { id: feeItemId } });
    if (!item) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费项目不存在' });
    const rows = await this.prisma.feeItemPeriod.findMany({
      where: { fee_item_id: feeItemId },
      include: { fee_period: { select: { id: true, code: true, name: true, status: true } } },
      orderBy: { fee_period: { start_date: 'desc' } },
    });
    return rows.map((r) => r.fee_period);
  }

  /** 全量替换收费项目的适用收费期（先删后增，事务保证原子性；须与项目同校区） */
  async setFeeItemPeriods(
    user: AdminUserInfo, feeItemId: string, dto: SetFeeItemPeriodsDto,
    requestId: string, ip: string,
  ) {
    const item = await this.prisma.feeItem.findUnique({ where: { id: feeItemId } });
    if (!item) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费项目不存在' });
    this.scope.assertCampus(user, item.campus_id, '校区');
    const periodIds = Array.from(new Set((dto.fee_period_ids || []).filter(Boolean)));
    await this.assertPeriodsInCampus(periodIds, item.campus_id);

    await this.prisma.$transaction(async (tx) => {
      await tx.feeItemPeriod.deleteMany({ where: { fee_item_id: feeItemId } });
      if (periodIds.length > 0) {
        await tx.feeItemPeriod.createMany({
          data: periodIds.map((pid) => ({ fee_item_id: feeItemId, fee_period_id: pid })),
          skipDuplicates: true,
        });
      }
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'fee-item.set-periods', resourceType: 'fee_item',
      resourceId: feeItemId, result: 'success', requestId, ip,
      metadata: { fee_period_ids: periodIds },
    });
    return this.getFeeItemPeriods(feeItemId);
  }

  /** 校验收费期存在且全部属于指定校区 */
  private async assertPeriodsInCampus(periodIds: string[], campusId: string) {
    if (periodIds.length === 0) return;
    const periods = await this.prisma.feePeriod.findMany({
      where: { id: { in: periodIds } },
      select: { id: true, name: true, campus_id: true },
    });
    if (periods.length !== periodIds.length) {
      throw new BadRequestException({ code: 'ERR_PERIOD_NOT_FOUND', message: '存在无效的收费期 ID' });
    }
    const mismatch = periods.find((p) => p.campus_id !== campusId);
    if (mismatch) {
      throw new BadRequestException({
        code: 'ERR_PERIOD_CAMPUS_MISMATCH',
        message: `收费期「${mismatch.name}」不属于该收费项目所在校区，不可绑定`,
      });
    }
  }
}
