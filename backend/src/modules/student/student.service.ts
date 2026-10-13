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
import { CreateStudentDto, FEE_ITEM_IMPORT_HEADERS, StudentQueryDto, UpdateStudentDto } from './dto/student.dto';

// 学生服务：档案 CRUD + Excel/CSV 导入（上传→解析→预览→确认→错误报告）
// 个人信息最小化：不收集身份证号；家长手机号加密存储
// 导入列：姓名*, 校区编码, 班级/年级, 家长手机号*, 内部学号*, 收费项目编码*
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
    // 绑定的收费项目必须存在、启用且属于学生所在校区
    await this.requireActiveFeeItemInCampus(dto.fee_item_id, campus.id);
    // 去重标准：校区 + 手机号 + 姓名（兄弟姐妹可共用家长手机号，以姓名区分）
    await this.assertPhoneNameUnique(campus.id, dto.guardian_phone, dto.name.trim(), null);
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
    // 传 null 表示清空绑定；传值则校验存在、启用且属于学生所在校区
    if (dto.fee_item_id !== undefined) {
      if (dto.fee_item_id) await this.requireActiveFeeItemInCampus(dto.fee_item_id, student.campus_id);
      data.fee_item_id = dto.fee_item_id || null;
    }
    // 姓名或手机号变更时，按 校区+手机号+姓名 重新去重（排除自己）
    if (data.name !== undefined || data.guardian_phone !== undefined) {
      const name = data.name !== undefined ? data.name : student.name;
      const phone = dto.guardian_phone !== undefined ? dto.guardian_phone : this.tryDecrypt(student.guardian_phone);
      if (phone) await this.assertPhoneNameUnique(student.campus_id, phone, name, id);
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

  /**
   * 按 校区+手机号+姓名 去重（手机号解密后比对；兄弟姐妹共用手机号时以姓名区分）。
   * excludeId：更新时排除自己。
   */
  private async assertPhoneNameUnique(campusId: string, phone: string, name: string, excludeId: string | null) {
    const students = await this.prisma.student.findMany({
      where: { campus_id: campusId, guardian_phone: { not: null } },
      select: { id: true, name: true, guardian_phone: true },
    });
    for (const s of students) {
      if (excludeId && s.id === excludeId) continue;
      if (s.name === name && this.tryDecrypt(s.guardian_phone) === phone) {
        throw new ConflictException({ code: 'ERR_DUPLICATE_STUDENT', message: `该校区已存在相同手机号+姓名的学生：${name}` });
      }
    }
  }

  private async requireActiveCampusById(id: string) {
    const campus = await this.prisma.campus.findUnique({ where: { id } });
    if (!campus || campus.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_CAMPUS_INVALID', message: '校区无效或已停用' });
    }
    return campus;
  }

  /** 校验收费项目存在、启用且属于指定校区（学生绑定用） */
  private async requireActiveFeeItemInCampus(id: string, campusId: string) {
    const item = await this.prisma.feeItem.findUnique({ where: { id } });
    if (!item || item.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_FEE_ITEM_INVALID', message: '收费项目不存在或已停用' });
    }
    if (item.campus_id !== campusId) {
      throw new BadRequestException({ code: 'ERR_FEE_ITEM_CAMPUS_MISMATCH', message: '收费项目不属于该学生所在校区' });
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

  // ─── 收费项目内学生导入（导入即分班） ───
  // 模板仅 3 列：姓名*、家长手机号*、班级/年级；导入行自动绑定该收费项目及其校区。
  // 匹配/去重标准：校区 + 手机号 + 姓名（兄弟姐妹共用家长手机号时以姓名区分）。
  // 名单中已存在的学生 → 更新绑定到本项目；不存在的 → 新建。

  /** 下载项目内导入模板 */
  async buildFeeItemTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('学生名单');
    ws.addRow(FEE_ITEM_IMPORT_HEADERS);
    ws.addRow(['张三', '13800001111', '高一(3)班']);
    ws.getRow(1).font = { bold: true };
    ws.columns = [{ width: 14 }, { width: 18 }, { width: 16 }];
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** 上传并解析：返回校验预览（不写学生表） */
  async uploadFeeItemPreview(
    user: AdminUserInfo,
    feeItemId: string,
    file: Express.Multer.File,
    requestId: string,
    ip: string,
  ) {
    const feeItem = await this.prisma.feeItem.findUnique({ where: { id: feeItemId } });
    if (!feeItem || feeItem.status !== 'active') {
      throw new BadRequestException({ code: 'ERR_FEE_ITEM_INVALID', message: '收费项目不存在或已停用' });
    }
    this.scope.assertCampus(user, feeItem.campus_id, '校区');
    if (!file || !/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      throw new BadRequestException({ code: 'ERR_FILE_TYPE', message: '请上传 .xlsx / .xls / .csv 文件' });
    }

    const rows = await this.parseFeeItemRows(file.originalname, file.buffer);
    const validated = await this.validateFeeItemRows(feeItem, rows);

    const job = await this.prisma.importJob.create({
      data: {
        campus_id: feeItem.campus_id,
        fee_item_id: feeItem.id,
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
      metadata: { file_name: file.originalname, total: validated.length, fee_item_id: feeItem.id },
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

  /**
   * 确认导入（导入即分班）：
   * - 名单中已存在的学生（校区+手机号+姓名匹配）→ 更新信息并绑定到本项目，计为更新
   * - 不存在的 → 新建并绑定到本项目，计为新增
   */
  async commitFeeItemImport(user: AdminUserInfo, jobId: string, requestId: string, ip: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '导入任务不存在' });
    if (!job.fee_item_id) {
      throw new BadRequestException({ code: 'ERR_JOB_TYPE', message: '该任务不是收费项目内导入任务' });
    }
    if (job.campus_id) this.scope.assertCampus(user, job.campus_id, '校区');
    if (job.status === 'committed') {
      throw new ConflictException({ code: 'ERR_JOB_COMMITTED', message: '该任务已确认导入，请勿重复提交' });
    }
    const rows = ((job.preview_json as any[]) || []).filter((r) => r.errors.length === 0);
    if (rows.length === 0) {
      throw new BadRequestException({ code: 'ERR_NO_VALID_ROWS', message: '没有可导入的有效行' });
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const r of rows) {
        if (r.action === 'update' && r.student_id) {
          await tx.student.update({
            where: { id: r.student_id },
            data: {
              name: r.name,
              grade_or_class: r.grade_or_class || null,
              guardian_phone: this.crypto.encryptField(r.guardian_phone),
              fee_item_id: job.fee_item_id,
            },
          });
          updated++;
        } else {
          try {
            await tx.student.create({
              data: {
                name: r.name,
                campus_id: job.campus_id!,
                student_no: null,
                grade_or_class: r.grade_or_class || null,
                guardian_phone: this.crypto.encryptField(r.guardian_phone),
                fee_item_id: job.fee_item_id,
              },
            });
            imported++;
          } catch (e: any) {
            // 并发导致的唯一冲突：跳过该行
            if (e?.code !== 'P2002') throw e;
            skipped++;
          }
        }
      }
      await tx.importJob.update({
        where: { id: jobId },
        // 确认后清理预览数据（个人信息最小化：不长期保存原始行数据）
        data: { status: 'committed', committed_count: imported + updated, preview_json: Prisma.JsonNull },
      });
    });

    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'student.import.commit', resourceType: 'import_job',
      resourceId: jobId, result: 'success', requestId, ip, metadata: { imported, updated, skipped },
    });
    return { imported, updated, skipped };
  }

  /** 下载错误报告（含错误原因列） */
  async buildErrorReport(user: AdminUserInfo, jobId: string): Promise<Buffer> {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '导入任务不存在' });
    if (job.campus_id) this.scope.assertCampus(user, job.campus_id, '校区');
    const rows = ((job.preview_json as any[]) || []).filter((r) => r.errors.length > 0);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('错误报告');
    ws.addRow([...FEE_ITEM_IMPORT_HEADERS, '错误原因']);
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow([r.name, r.guardian_phone_masked, r.grade_or_class, r.errors.join('；')]);
    }
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'student.import.error_report',
      resourceType: 'import_job', resourceId: jobId, result: 'success',
      metadata: { error_rows: rows.length },
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

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
    const validRows = rows.filter((r) => (r.errors || []).length === 0);
    return {
      id: job.id,
      file_name: job.file_name,
      status: statusMap[job.status] || job.status,
      total_rows: job.total_rows,
      valid_rows: job.valid_rows,
      error_rows: job.invalid_rows,
      // 导入即分班：有效行中新增 / 更新（转入本项目）的数量
      new_rows: validRows.filter((r) => r.action !== 'update').length,
      update_rows: validRows.filter((r) => r.action === 'update').length,
      errors,
      created_at: job.created_at,
    };
  }

  // ─── 内部：解析与校验 ───

  // ─── 内部：解析与校验（项目内导入，3 列） ───

  private async parseFeeItemRows(filename: string, buffer: Buffer): Promise<Record<string, string>[]> {
    if (/\.csv$/i.test(filename)) return this.parseFeeItemCsv(buffer);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException({ code: 'ERR_FILE_EMPTY', message: 'Excel 文件为空' });
    const rows: Record<string, string>[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // 表头
      const v = (c: number) => String(row.getCell(c).value ?? '').trim();
      if (!v(1) && !v(2) && !v(3)) return; // 全空行跳过
      rows.push({
        name: v(1), guardian_phone: v(2), grade_or_class: v(3), _line: String(rowNumber),
      });
    });
    return this.checkRows(rows);
  }

  /** 简易 CSV 解析（处理 BOM 与引号包裹字段） */
  private parseFeeItemCsv(buffer: Buffer): Record<string, string>[] {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
    const lines = text.split(/\r?\n/);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const cells = this.splitCsvLine(line);
      const v = (n: number) => (cells[n] || '').trim();
      if (!v(0) && !v(1) && !v(2)) continue;
      rows.push({ name: v(0), guardian_phone: v(1), grade_or_class: v(2), _line: String(i + 1) });
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

  /**
   * 校验项目内导入行。匹配/去重标准：校区 + 手机号 + 姓名。
   * - 文件内 (手机号,姓名) 重复 → 报错
   * - 库中已存在 (校区+手机号+姓名) → action=update（导入即分班：更新绑定到本项目）
   * - 不存在 → action=create
   */
  private async validateFeeItemRows(
    feeItem: { id: string; campus_id: string },
    rows: Record<string, string>[],
  ) {
    const phoneRe = /^1[3-9]\d{9}$/;
    // 一次性加载该校区已有学生，解密手机号后建 (手机号::姓名) → 学生 映射
    const existing = await this.prisma.student.findMany({
      where: { campus_id: feeItem.campus_id, guardian_phone: { not: null } },
      select: { id: true, name: true, guardian_phone: true },
    });
    const existingMap = new Map<string, string>();
    for (const s of existing) {
      const phone = this.tryDecrypt(s.guardian_phone);
      if (phone) existingMap.set(`${phone}::${s.name}`, s.id);
    }

    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of rows) {
      const errors: string[] = [];
      const name = (r.name || '').trim();
      const guardian_phone = (r.guardian_phone || '').trim();
      const grade_or_class = (r.grade_or_class || '').trim();
      if (!name) errors.push('姓名必填');
      else if (name.length > 64) errors.push('姓名过长（最多64字符）');
      if (!guardian_phone) errors.push('家长手机号必填（学生用手机号登录）');
      else if (!phoneRe.test(guardian_phone)) errors.push('家长手机号格式不正确');
      const key = `${guardian_phone}::${name}`;
      if (name && guardian_phone && phoneRe.test(guardian_phone)) {
        if (seen.has(key)) {
          errors.push('文件内手机号+姓名重复');
        } else {
          seen.add(key);
        }
      }
      if (grade_or_class.length > 64) errors.push('班级/年级过长（最多64字符）');

      const matchedId = errors.length === 0 ? existingMap.get(key) : undefined;
      out.push({
        line: Number(r._line) || 0,
        name,
        guardian_phone,
        guardian_phone_masked: guardian_phone ? guardian_phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '',
        grade_or_class,
        // 导入即分班：已存在 → 更新绑定到本项目；不存在 → 新建
        action: matchedId ? 'update' : 'create',
        student_id: matchedId || null,
        errors,
      });
    }
    return out;
  }
}
