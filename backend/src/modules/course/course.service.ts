import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';
import { paginate } from '../../common/dto/pagination.dto';
import { CampusPriceQueryDto, CourseQueryDto, FeeItemQueryDto } from './dto/course.dto';
import {
  CloseCampusPriceDto, CreateCampusPriceDto, CreateCourseDto, CreateFeeItemDto,
  UpdateCourseDto, UpdateFeeItemDto,
} from './dto/course.dto';

// 课程 / 收费项目 / 校区价格服务
// 铁律：调价只新增价格记录（设旧记录失效期），已被账单引用的价格不物理删除；
// 同一项目+校区+有效期不允许重叠（验收 F-09）
@Injectable()
export class CourseService {
  constructor(
    private readonly prisma: PrismaService,
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

  async listFeeItems(query: FeeItemQueryDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.course_id) where.course_id = query.course_id;
    if (query.keyword) where.OR = [{ name: { contains: query.keyword } }, { code: { contains: query.keyword } }];
    const [total, items] = await Promise.all([
      this.prisma.feeItem.count({ where }),
      this.prisma.feeItem.findMany({ where, include: { course: true }, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return paginate(items, total, page, pageSize);
  }

  async createFeeItem(user: AdminUserInfo, dto: CreateFeeItemDto, requestId: string, ip: string) {
    try {
      const item = await this.prisma.feeItem.create({ data: { ...dto } });
      await this.audit.log({ actorType: 'admin', actorId: user.id, action: 'fee-item.create', resourceType: 'fee_item', resourceId: item.id, result: 'success', requestId, ip, metadata: { code: item.code } });
      return item;
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException({ code: 'ERR_DUPLICATE_CODE', message: '收费项目编码已存在' });
      throw e;
    }
  }

  async updateFeeItem(user: AdminUserInfo, id: string, dto: UpdateFeeItemDto, requestId: string, ip: string) {
    const item = await this.prisma.feeItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '收费项目不存在' });
    const updated = await this.prisma.feeItem.update({ where: { id }, data: { ...dto } });
    // 价格调整审计（验收 F-10 要求调价可追溯）
    await this.audit.log({ actorType: 'admin', actorId: user.id, action: 'fee-item.update', resourceType: 'fee_item', resourceId: id, result: 'success', requestId, ip, metadata: { changes: Object.keys(dto) } });
    return updated;
  }

  // ─── 校区价格 ───

  async listCampusPrices(
    user: AdminUserInfo,
    query: CampusPriceQueryDto,
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    if (query.fee_item_id) where.fee_item_id = query.fee_item_id;
    if (query.campus_id) {
      this.scope.assertCampus(user, query.campus_id, '校区');
      where.campus_id = query.campus_id;
    } else {
      const sf = this.scope.scopeFilter(user);
      if (sf) where.campus_id = sf;
    }
    const [total, items] = await Promise.all([
      this.prisma.campusFeePrice.count({ where }),
      this.prisma.campusFeePrice.findMany({
        where, include: { fee_item: true }, orderBy: { effective_from: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return paginate(items, total, page, pageSize);
  }

  /** 新增校区价格：同一项目+校区有效期不允许重叠 */
  async createCampusPrice(user: AdminUserInfo, dto: CreateCampusPriceDto, requestId: string, ip: string) {
    this.scope.assertCampus(user, dto.campus_id, '校区');
    const item = await this.prisma.feeItem.findUnique({ where: { id: dto.fee_item_id } });
    if (!item || item.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_FEE_ITEM_INVALID', message: '收费项目不存在或已停用' });
    }
    const campus = await this.prisma.campus.findUnique({ where: { id: dto.campus_id } });
    if (!campus || campus.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '校区无效或已停用' });
    }
    const from = new Date(dto.effective_from);
    const to = dto.effective_to ? new Date(dto.effective_to) : null;
    if (to && to < from) {
      throw new BadRequestException({ code: 'ERR_DATE_RANGE', message: '失效日期不得早于生效日期' });
    }

    // 重叠校验：新区间 [from, to||∞) 与现有任一区间相交即拒绝
    const existing = await this.prisma.campusFeePrice.findMany({
      where: { fee_item_id: dto.fee_item_id, campus_id: dto.campus_id },
    });
    for (const e of existing) {
      const eFrom = new Date(e.effective_from);
      const eTo = e.effective_to ? new Date(e.effective_to) : null;
      const overlap = from <= (eTo || new Date('9999-12-31')) && (to || new Date('9999-12-31')) >= eFrom;
      if (overlap) {
        throw new ConflictException({ code: 'ERR_PRICE_OVERLAP', message: '该项目在该校区的有效期存在重叠价格，请先将旧价格设失效' });
      }
    }

    const price = await this.prisma.campusFeePrice.create({
      data: {
        fee_item_id: dto.fee_item_id, campus_id: dto.campus_id,
        amount_fen: BigInt(dto.amount_fen),
        effective_from: from, effective_to: to, created_by: user.id,
      },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'campus-price.create', resourceType: 'campus_fee_price',
      resourceId: price.id, result: 'success', requestId, ip,
      metadata: { fee_item_id: dto.fee_item_id, campus_id: dto.campus_id, amount_fen: dto.amount_fen },
    });
    return price;
  }

  /** 关闭价格（设失效日期），不物理删除 */
  async closeCampusPrice(user: AdminUserInfo, id: string, dto: CloseCampusPriceDto, requestId: string, ip: string) {
    const price = await this.prisma.campusFeePrice.findUnique({ where: { id } });
    if (!price) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '价格记录不存在' });
    this.scope.assertCampus(user, price.campus_id, '校区');
    const to = new Date(dto.effective_to);
    if (to < new Date(price.effective_from)) {
      throw new BadRequestException({ code: 'ERR_DATE_RANGE', message: '失效日期不得早于生效日期' });
    }
    const updated = await this.prisma.campusFeePrice.update({ where: { id }, data: { effective_to: to } });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'campus-price.close', resourceType: 'campus_fee_price',
      resourceId: id, result: 'success', requestId, ip,
    });
    return updated;
  }

  /** 查询某校区某日有效的价格（账单生成/金额核算用） */
  async getEffectivePrices(campusId: string, atDate: Date) {
    const prices = await this.prisma.campusFeePrice.findMany({
      where: {
        campus_id: campusId,
        effective_from: { lte: atDate },
        OR: [{ effective_to: null }, { effective_to: { gte: atDate } }],
      },
      include: { fee_item: true },
    });
    // 只要项目启用的
    return prices.filter((p) => p.fee_item.status === 'active');
  }
}
