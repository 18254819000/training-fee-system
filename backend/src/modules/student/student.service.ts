import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CampusScopeService } from '../../common/guards/campus-scope.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { CreateStudentDto, IMPORT_TEMPLATE_HEADERS, StudentQueryDto, UpdateStudentDto } from './dto/student.dto';

// 学生服务：档案 CRUD + Excel/CSV 导入（上传→解析→预览→确认→错误报告）
// 个人信息最小化：不收集身份证号；家长手机号加密存储
// 导入列：姓名*, 校区编码, 班级/年级, 家长手机号, 内部学号*, 收费项目编码
// 校区归属：上传时可指定 campus_id（整批归属），否则按行读取"校区编码"列
@Injectable()
export class StudentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly scope: CampusScopeService,
    private readonly audit: AuditService,
  ) {}

  // ─── 档案 CRUD ───

  async list(
    user: AdminUserInfo,
    query: StudentQueryDto,
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    const scopeFilter = this.scope.scopeFilter(user);
    if (query.campus_id) {
      this.scope.assertCampus(user, query.campus_id, '校区');
      where.campus_id = query.campus_id;
    } else if (scopeFilter) {
      where.campus_id = scopeFilter;
    }
    if (query.status) where.status = query.status;
    if (query.keyword) {
      where.OR = [{ name: { contains: query.keyword } }, { student_no: { contains: query.keyword } }];
    }
    const [total, items] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({
        where,
        include: {
          campus: { select: { id: true, code: true, name: true } },
          fee_item: { select: { id: true, code: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const masked = items.map((s) => ({
      ...s,
      campus_name: s.campus.name,
      fee_item_name: s.fee_item?.name ?? null,
      guardian_phone: s.guardian_phone
        ? this.crypto.maskPhone(this.tryDecrypt(s.guardian_phone))
        : null,
    }));
    return paginate(masked, total, page, pageSize);
  }

  async get(user: AdminUserInfo, id: string) {
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { campus: true },
    });
    if (!student) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '学生不存在' });
    this.scope.assertCampus(user, student.campus_id, '学生');
    return student;
  }

  async create(user: AdminUserInfo, dto: CreateStudentDto, requestId: string, ip: string) {
    const campus = await this.requireActiveCampusById(dto.campus_id);
    this.scope.assertCampus(user, campus.id, '校区');
    // 绑定的收费项目必须存在且启用
    if (dto.fee_item_id) await this.requireActiveFeeItem(dto.fee_item_id);
    try {
      const student = await this.prisma.student.create({
        data: {
          name: dto.name.trim(),
          campus_id: campus.id,
          student_no: dto.student_no?.trim() || null,
          grade_or_class: dto.grade_or_class?.trim() || null,
          guardian_phone: this.crypto.encryptField(dto.guardian_phone),
          fee_item_id: dto.fee_item_id || null,
        },
      });
      await this.audit.log({
        actorType: 'admin', actorId: user.id, action: 'student.create', resourceType: 'student',
        resourceId: student.id, result: 'success', requestId, ip,
        metadata: { name: student.name, campus_id: campus.id },
      });
      return student;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException({ code: 'ERR_DUPLICATE_STUDENT_NO', message: '该校区下学号已存在' });
      }
      throw e;
    }
  }

  async update(user: AdminUserInfo, id: string, dto: UpdateStudentDto, requestId: string, ip: string) {
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '学生不存在' });
    this.scope.assertCampus(user, student.campus_id, '学生');
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.student_no !== undefined) data.student_no = dto.student_no?.trim() || null;
    if (dto.grade_or_class !== undefined) data.grade_or_class = dto.grade_or_class?.trim() || null;
    if (dto.guardian_phone !== undefined) data.guardian_phone = this.crypto.encryptField(dto.guardian_phone);
    if (dto.status !== undefined) data.status = dto.status;
    // 传 null 表示清空绑定；传值则校验存在且启用
    if (dto.fee_item_id !== undefined) {
      if (dto.fee_item_id) await this.requireActiveFeeItem(dto.fee_item_id);
      data.fee_item_id = dto.fee_item_id || null;
    }
    try {
      const updated = await this.prisma.student.update({ where: { id }, data });
      await this.audit.log({
        actorType: 'admin', actorId: user.id, action: 'student.update', resourceType: 'student',
        resourceId: id, result: 'success', requestId, ip, metadata: { changes: Object.keys(data) },
      });
      return updated;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException({ code: 'ERR_DUPLICATE_STUDENT_NO', message: '该校区下学号已存在' });
      }
      throw e;
    }
  }

  private async requireActiveCampusById(id: string) {
    const campus = await this.prisma.campus.findUnique({ where: { id } });
    if (!campus || campus.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '校区无效或已停用' });
    }
    return campus;
  }

  private async requireActiveCampusByCode(code: string) {
    const campus = await this.prisma.campus.findUnique({ where: { code } });
    if (!campus || campus.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: `校区编码无效或已停用：${code}` });
    }
    return campus;
  }

  /** 校验收费项目存在且启用（学生绑定用） */
  private async requireActiveFeeItem(id: string) {
    const item = await this.prisma.feeItem.findUnique({ where: { id } });
    if (!item || item.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_FEE_ITEM_INVALID', message: '收费项目不存在或已停用' });
    }
    return item;
  }

  private tryDecrypt(v: string | null): string | null {
    try {
      return this.crypto.decryptField(v);
    } catch {
      return null;
    }
  }

  // ─── Excel/CSV 导入 ───

  /** 下载导入模板（与前端 CSV 模板列一致） */
  async buildTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('学生名单');
    ws.addRow(IMPORT_TEMPLATE_HEADERS);
    ws.addRow(['张三', 'BJ01', '高一(3)班', '13800001111', 'XS2026001', 'N5-FEE']);
    ws.getRow(1).font = { bold: true };
    ws.columns = [{ width: 14 }, { width: 14 }, { width: 16 }, { width: 18 }, { width: 16 }, { width: 16 }];
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** 上传并解析：返回校验预览（不写学生表） */
  async uploadPreview(
    user: AdminUserInfo,
    campusId: string | undefined,
    feePeriodId: string | undefined,
    file: Express.Multer.File,
    requestId: string,
    ip: string,
  ) {
    if (campusId) this.scope.assertCampus(user, campusId, '校区');
    if (!file || !/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      throw new BadRequestException({ code: 'ERR_FILE_TYPE', message: '请上传 .xlsx / .xls / .csv 文件' });
    }

    const rows = await this.parseRows(file.originalname, file.buffer);
    const validated = await this.validateRows(user, campusId, rows);

    const job = await this.prisma.importJob.create({
      data: {
        campus_id: campusId || null,
        fee_period_id: feePeriodId || null,
        file_name: file.originalname,
        status: 'previewed',
        total_rows: validated.length,
        valid_rows: validated.filter((r) => r.errors.length === 0).length,
        invalid_rows: validated.filter((r) => r.errors.length > 0).length,
        preview_json: validated as any,
        created_by: user.id,
      },
    });

    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'student.import.upload', resourceType: 'import_job',
      resourceId: job.id, result: 'success', requestId, ip,
      metadata: { file_name: file.originalname, total: validated.length },
    });

    return this.presentJob(job, validated);
  }

  async getPreview(user: AdminUserInfo, jobId: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '导入任务不存在' });
    if (job.campus_id) this.scope.assertCampus(user, job.campus_id, '校区');
    if (job.status === 'committed' || !job.preview_json) {
      throw new BadRequestException({ code: 'ERR_JOB_STATE', message: '该任务已确认导入或预览已过期' });
    }
    return this.presentJob(job, (job.preview_json as any[]) || []);
  }

  /** 确认导入：只写入校验通过的行 */
  async commit(user: AdminUserInfo, jobId: string, requestId: string, ip: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '导入任务不存在' });
    if (job.campus_id) this.scope.assertCampus(user, job.campus_id, '校区');
    if (job.status === 'committed') {
      throw new ConflictException({ code: 'ERR_JOB_COMMITTED', message: '该任务已确认导入，请勿重复提交' });
    }
    const rows = ((job.preview_json as any[]) || []).filter((r) => r.errors.length === 0 && r.campus_id);
    if (rows.length === 0) {
      throw new BadRequestException({ code: 'ERR_NO_VALID_ROWS', message: '没有可导入的有效行' });
    }
    // 逐行校区范围校验
    const campusIds = Array.from(new Set(rows.map((r) => r.campus_id as string)));
    for (const cid of campusIds) this.scope.assertCampus(user, cid, '校区');

    let imported = 0;
    let skipped = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const r of rows) {
        try {
          await tx.student.create({
            data: {
              name: r.name,
              campus_id: r.campus_id,
              student_no: r.student_no || null,
              grade_or_class: r.grade_or_class || null,
              guardian_phone: this.crypto.encryptField(r.guardian_phone || null),
              fee_item_id: r.fee_item_id || null,
            },
          });
          imported++;
        } catch (e: any) {
          // 并发导致的唯一冲突：跳过该行（验收 F-06：重复学生不被意外创建）
          if (e?.code !== 'P2002') throw e;
          skipped++;
        }
      }
      await tx.importJob.update({
        where: { id: jobId },
        // 确认后清理预览数据（个人信息最小化：不长期保存原始行数据）
        data: { status: 'committed', committed_count: imported, preview_json: Prisma.JsonNull },
      });
    });

    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'student.import.commit', resourceType: 'import_job',
      resourceId: jobId, result: 'success', requestId, ip, metadata: { imported, skipped },
    });
    return { imported, skipped };
  }

  /** 下载错误报告（含错误原因列） */
  async buildErrorReport(user: AdminUserInfo, jobId: string): Promise<Buffer> {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '导入任务不存在' });
    if (job.campus_id) this.scope.assertCampus(user, job.campus_id, '校区');
    const rows = ((job.preview_json as any[]) || []).filter((r) => r.errors.length > 0);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('错误报告');
    ws.addRow([...IMPORT_TEMPLATE_HEADERS, '错误原因']);
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow([r.name, r.campus_code, r.grade_or_class, r.guardian_phone_masked, r.student_no, r.fee_item_code, r.errors.join('；')]);
    }
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'student.import.error_report',
      resourceType: 'import_job', resourceId: jobId, result: 'success',
      metadata: { error_rows: rows.length },
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** 任务展示（前端 ImportJob 形状） */
  private presentJob(job: any, rows: any[]) {
    const statusMap: Record<string, string> = {
      uploaded: 'uploaded', previewed: 'preview', committed: 'done', failed: 'failed',
    };
    const errors: Array<{ row: number; field?: string; message: string }> = [];
    for (const r of rows) {
      for (const msg of r.errors || []) {
        errors.push({ row: Number(r.line) || 0, message: String(msg) });
      }
    }
    return {
      id: job.id,
      file_name: job.file_name,
      status: statusMap[job.status] || job.status,
      total_rows: job.total_rows,
      valid_rows: job.valid_rows,
      error_rows: job.invalid_rows,
      errors,
      created_at: job.created_at,
    };
  }

  // ─── 内部：解析与校验 ───

  private async parseRows(filename: string, buffer: Buffer): Promise<Record<string, string>[]> {
    if (/\.csv$/i.test(filename)) return this.parseCsv(buffer);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException({ code: 'ERR_FILE_EMPTY', message: 'Excel 文件为空' });
    const rows: Record<string, string>[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // 表头
      const v = (c: number) => String(row.getCell(c).value ?? '').trim();
      if (!v(1) && !v(2) && !v(3) && !v(4) && !v(5) && !v(6)) return; // 全空行跳过
      rows.push({
        name: v(1), campus_code: v(2), grade_or_class: v(3),
        guardian_phone: v(4), student_no: v(5), fee_item_code: v(6), _line: String(rowNumber),
      });
    });
    return this.checkRows(rows);
  }

  /** 简易 CSV 解析（处理 BOM 与引号包裹字段） */
  private parseCsv(buffer: Buffer): Record<string, string>[] {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
    const lines = text.split(/\r?\n/);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const cells = this.splitCsvLine(line);
      const v = (n: number) => (cells[n] || '').trim();
      if (!v(0) && !v(1) && !v(2) && !v(3) && !v(4) && !v(5)) continue;
      rows.push({
        name: v(0), campus_code: v(1), grade_or_class: v(2),
        guardian_phone: v(3), student_no: v(4), fee_item_code: v(5), _line: String(i + 1),
      });
    }
    return this.checkRows(rows);
  }

  private splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQuote = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        out.push(cur); cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  private checkRows(rows: Record<string, string>[]): Record<string, string>[] {
    if (rows.length === 0) throw new BadRequestException({ code: 'ERR_FILE_EMPTY', message: '未解析到有效数据行' });
    if (rows.length > 5000) throw new BadRequestException({ code: 'ERR_FILE_TOO_LARGE', message: '单次导入不超过 5000 行' });
    return rows;
  }

  private async validateRows(
    user: AdminUserInfo, jobCampusId: string | undefined, rows: Record<string, string>[],
  ) {
    const phoneRe = /^1[3-9]\d{9}$/;
    // 收集涉及的校区编码
    const codes = new Set<string>();
    if (jobCampusId) {
      const c = await this.prisma.campus.findUnique({ where: { id: jobCampusId } });
      if (!c || c.status !== 'active') {
        throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '指定的校区无效或已停用' });
      }
    }
    for (const r of rows) {
      if (!jobCampusId && r.campus_code) codes.add(r.campus_code);
    }
    const campusList = codes.size > 0
      ? await this.prisma.campus.findMany({ where: { code: { in: Array.from(codes) } } })
      : [];
    const campusByCode = new Map(campusList.map((c) => [c.code, c]));
    // 收集收费项目编码并校验存在性
    const feeItemCodes = new Set<string>();
    for (const r of rows) {
      if (r.fee_item_code) feeItemCodes.add(r.fee_item_code);
    }
    const feeItemList = feeItemCodes.size > 0
      ? await this.prisma.feeItem.findMany({ where: { code: { in: Array.from(feeItemCodes) } } })
      : [];
    const feeItemByCode = new Map(feeItemList.map((f) => [f.code, f]));
    // 各校区已有学号（去重用）
    const campusIds = new Set<string>();
    if (jobCampusId) campusIds.add(jobCampusId);
    for (const c of campusList) campusIds.add(c.id);
    const existing = campusIds.size > 0
      ? await this.prisma.student.findMany({
        where: { campus_id: { in: Array.from(campusIds) }, student_no: { not: null } },
        select: { campus_id: true, student_no: true },
      })
      : [];
    const existingKeys = new Set(existing.map((s) => `${s.campus_id}::${s.student_no}`));
    const seenKeys = new Set<string>();

    return rows.map((r) => {
      const errors: string[] = [];
      let campusId: string | null = null;
      let campusCode: string | null = null;
      if (jobCampusId) {
        campusId = jobCampusId;
      } else if (r.campus_code) {
        const c = campusByCode.get(r.campus_code);
        if (!c || c.status !== 'active') {
          errors.push(`校区编码无效或已停用：${r.campus_code}`);
        } else {
          campusId = c.id;
          campusCode = c.code;
        }
      } else {
        errors.push('校区编码必填（未指定导入校区时）');
      }
      if (campusId) {
        try {
          this.scope.assertCampus(user, campusId, '校区');
        } catch {
          errors.push('无权导入该校区');
          campusId = null;
        }
      }

      if (!r.name) errors.push('姓名必填');
      if (r.name && r.name.length > 100) errors.push('姓名过长');
      // 内部学号必填：作为去重唯一键
      if (!r.student_no) {
        errors.push('内部学号必填（用于去重）');
      } else if (campusId) {
        const key = `${campusId}::${r.student_no}`;
        if (existingKeys.has(key)) errors.push(`学号已存在：${r.student_no}`);
        else if (seenKeys.has(key)) errors.push(`本批次学号重复：${r.student_no}`);
        else seenKeys.add(key);
      }
      if (r.guardian_phone && !phoneRe.test(r.guardian_phone)) errors.push('家长手机号格式不正确');

      // 收费项目编码：填了就必须存在且启用
      let feeItemId: string | null = null;
      if (r.fee_item_code) {
        const fi = feeItemByCode.get(r.fee_item_code);
        if (!fi) {
          errors.push(`收费项目编码无效：${r.fee_item_code}`);
        } else if (fi.status !== 'active') {
          errors.push(`收费项目已停用：${r.fee_item_code}`);
        } else {
          feeItemId = fi.id;
        }
      }

      return {
        line: r._line,
        name: r.name,
        campus_id: campusId,
        campus_code: campusCode || r.campus_code || null,
        student_no: r.student_no || null,
        grade_or_class: r.grade_or_class || null,
        guardian_phone: r.guardian_phone || null,
        guardian_phone_masked: r.guardian_phone ? this.crypto.maskPhone(r.guardian_phone) : null,
        fee_item_code: r.fee_item_code || null,
        fee_item_id: feeItemId,
        errors,
      };
    });
  }
}
