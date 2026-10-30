import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo, StudentSessionInfo } from '../../common/types';
import { paginate } from '../../common/dto/pagination.dto';
import {
  CreateReservationCourseDto, ReservationCourseQueryDto, UpdateReservationCourseDto,
} from './dto/reservation-course.dto';

// 预约课程服务：管理端设置（校区隔离）+ 公开/学生端读取。
// 与收费项目/账单体系分离：不走收费期，不生成账单，购买走独立的预约订单 + 支付订单。
@Injectable()
export class ReservationCourseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CampusScopeService,
    private readonly audit: AuditService,
  ) {}

  /** 是否已到期：当前时刻超过截止时间即到期 */
  static isExpired(deadline: Date): boolean {
    return new Date() > deadline;
  }

  /** 展示排序：未到期在前（按截止时间升序），已到期沉底 */
  private sortForDisplay(items: any[]) {
    const expired = (c: any) => ReservationCourseService.isExpired(c.deadline) ? 1 : 0;
    return [...items].sort((a, b) =>
      expired(a) - expired(b) ||
      new Date(a.deadline).getTime() - new Date(b.deadline).getTime(),
    );
  }

  /** 公开 DTO：价格转 Number，附带到期标记与校区名（前端直接渲染） */
  private toPublicDto(c: any) {
    return {
      id: c.id,
      campusId: c.campus_id,
      campusName: c.campus?.name,
      name: c.name,
      description: c.description,
      amountFen: Number(c.amount_fen),
      deadline: c.deadline,
      expired: ReservationCourseService.isExpired(c.deadline),
      status: c.status,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  }

  // ─── 管理端 ───

  async list(user: AdminUserInfo, query: ReservationCourseQueryDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.keyword) where.name = { contains: query.keyword };
    const scopeFilter = this.scope.scopeFilter(user);
    if (query.campus_id) {
      this.scope.assertCampus(user, query.campus_id, '校区');
      where.campus_id = query.campus_id;
    } else if (scopeFilter) {
      where.campus_id = scopeFilter;
    }
    const [total, items] = await Promise.all([
      this.prisma.reservationCourse.count({ where }),
      this.prisma.reservationCourse.findMany({
        where,
        include: { campus: { select: { id: true, code: true, name: true } } },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return paginate(items.map((it: any) => this.toPublicDto(it)), total, page, pageSize);
  }

  async create(user: AdminUserInfo, dto: CreateReservationCourseDto, requestId: string, ip: string) {
    const campus = await this.prisma.campus.findUnique({ where: { id: dto.campus_id } });
    if (!campus || campus.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '所属校区无效或已停用' });
    }
    this.scope.assertCampus(user, campus.id, '校区');
    const item = await this.prisma.reservationCourse.create({
      data: {
        campus_id: campus.id,
        name: dto.name,
        description: dto.description || null,
        amount_fen: BigInt(dto.amount_fen),
        deadline: new Date(dto.deadline),
      },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'reservation-course.create', resourceType: 'reservation_course',
      resourceId: item.id, result: 'success', requestId, ip,
      metadata: { campus_id: campus.id, amount_fen: dto.amount_fen, deadline: dto.deadline },
    });
    return item;
  }

  async update(user: AdminUserInfo, id: string, dto: UpdateReservationCourseDto, requestId: string, ip: string) {
    const existing = await this.prisma.reservationCourse.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '预约课程不存在' });
    this.scope.assertCampus(user, existing.campus_id, '校区');
    const updated = await this.prisma.reservationCourse.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        amount_fen: dto.amount_fen !== undefined ? BigInt(dto.amount_fen) : undefined,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        status: dto.status,
      },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'reservation-course.update', resourceType: 'reservation_course',
      resourceId: id, result: 'success', requestId, ip,
      metadata: { name: dto.name, amount_fen: dto.amount_fen, deadline: dto.deadline, status: dto.status },
    });
    return updated;
  }

  async remove(user: AdminUserInfo, id: string, requestId: string, ip: string) {
    const existing = await this.prisma.reservationCourse.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } },
    });
    if (!existing) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '预约课程不存在' });
    this.scope.assertCampus(user, existing.campus_id, '校区');
    if (existing._count.orders > 0) {
      throw new BadRequestException({ code: 'ERR_COURSE_HAS_ORDERS', message: '该课程已有购买订单，不可删除；可改为停用' });
    }
    await this.prisma.reservationCourse.delete({ where: { id } });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'reservation-course.delete', resourceType: 'reservation_course',
      resourceId: id, result: 'success', requestId, ip,
    });
    return { id };
  }

  // ─── 公开读取（小程序首页游客也可看；仅返回启用课程）───

  async publicList(campusCode?: string) {
    let campusIds: string[] | undefined;
    if (campusCode) {
      const campus = await this.prisma.campus.findUnique({ where: { code: campusCode } });
      if (!campus) return [];
      campusIds = [campus.id];
    }
    const items = await this.prisma.reservationCourse.findMany({
      where: { status: 'active', ...(campusIds ? { campus_id: { in: campusIds } } : {}) },
      include: { campus: { select: { id: true, name: true } } },
      orderBy: [{ deadline: 'asc' }, { created_at: 'asc' }],
    });
    return this.sortForDisplay(items).map((it: any) => this.toPublicDto(it));
  }

  async publicDetail(id: string) {
    const item = await this.prisma.reservationCourse.findUnique({
      where: { id },
      include: { campus: { select: { id: true, name: true } } },
    });
    if (!item || item.status !== 'active') {
      throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '课程不存在或已下架' });
    }
    return this.toPublicDto(item);
  }

  // ─── 学生端读取（登录后：仅看自己所在校区的启用课程）───

  async studentList(session: StudentSessionInfo) {
    const students = await this.prisma.student.findMany({
      where: { id: { in: session.studentIds } },
      select: { campus_id: true },
    });
    const campusIds = [...new Set(students.map((s) => s.campus_id))];
    if (campusIds.length === 0) return [];
    const items = await this.prisma.reservationCourse.findMany({
      where: { status: 'active', campus_id: { in: campusIds } },
      include: { campus: { select: { id: true, name: true } } },
      orderBy: [{ deadline: 'asc' }, { created_at: 'asc' }],
    });
    return this.sortForDisplay(items).map((it: any) => this.toPublicDto(it));
  }
}
