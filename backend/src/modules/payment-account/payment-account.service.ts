import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../audit/audit.service';
import { AdminUserInfo } from '../../common/types';

// 微信支付账户配置：密钥只存引用（enc:v1:...），永不回显明文
// 流程：创建草稿 → 上传密钥/填写 → validate 自检 → activate 启用 → disable 停用
@Injectable()
export class PaymentAccountService {
  private readonly logger = new Logger(PaymentAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ─── 查询（脱敏：只返回是否已配置，不回显任何密钥/引用） ───

  async list() {
    const accounts = await this.prisma.paymentAccount.findMany({
      include: { payment_account_campuses: true },
      orderBy: { created_at: 'desc' },
    });
    return accounts.map((a) => this.mask(a));
  }

  async get(id: string) {
    const account = await this.prisma.paymentAccount.findUnique({
      where: { id },
      include: { payment_account_campuses: true },
    });
    if (!account) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '支付账户不存在' });
    return this.mask(account);
  }

  private mask(a: any) {
    const campusIds = (a.payment_account_campuses || []).map((c: any) => c.campus_id);
    return {
      id: a.id,
      name: a.name,
      environment: a.environment,
      app_id: a.app_id,
      mch_id: a.mch_id,
      merchant_cert_serial: a.merchant_cert_serial,
      private_key_configured: !!a.private_key_secret_ref,
      apiv3_secret_configured: !!a.apiv3_secret_ref,
      platform_key_configured: !!a.platform_key_config_ref,
      notify_url: a.notify_url,
      refund_policy: a.refund_policy,
      remark: a.remark,
      scope_type: campusIds.length > 0 ? 'campuses' : 'all',
      campus_ids: campusIds,
      status: a.status,
      last_validated_at: a.last_validated_at,
      last_validation_result: a.last_validation_result,
      created_at: a.created_at,
      updated_at: a.updated_at,
    };
  }

  // ─── 创建 / 更新（支持 multipart 私钥文件） ───

  /** 解析 FormData（前端把每个字段 JSON.stringify 后 append）或普通 JSON */
  private parseFields(body: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (typeof v === 'string') {
        try {
          out[k] = JSON.parse(v);
          continue;
        } catch {
          /* 非 JSON 字符串则原样保留 */
        }
      }
      out[k] = v;
    }
    return out;
  }

  private toSecretRef(plain: string | undefined | null, fieldName: string): string | undefined {
    if (plain === undefined || plain === null || plain === '') return undefined; // 空 = 不修改/不设置
    // 直接存加密引用；若用户填的是 env:VAR_NAME 形式则原样保留为引用
    if (/^(env|kms):/.test(plain.trim())) return plain.trim();
    return this.crypto.encryptField(plain) || undefined;
  }

  async create(
    user: AdminUserInfo, rawBody: Record<string, any>,
    keyFile: Express.Multer.File | undefined,
    requestId: string, ip: string,
  ) {
    const body = this.parseFields(rawBody);
    this.validateBasicFields(body, true);

    let privateKeyRef: string | undefined;
    if (keyFile?.buffer) {
      privateKeyRef = this.toSecretRef(keyFile.buffer.toString('utf8'), '商户私钥');
    }

    const account = await this.prisma.paymentAccount.create({
      data: {
        name: String(body.name).trim(),
        environment: body.environment,
        app_id: String(body.appId || body.app_id).trim(),
        mch_id: String(body.mchId || body.mch_id).trim(),
        merchant_cert_serial: body.merchantCertSerial || body.merchant_cert_serial || null,
        private_key_secret_ref: privateKeyRef || null,
        apiv3_secret_ref: this.toSecretRef(body.apiv3Secret || body.apiv3_secret, 'APIv3 密钥') || null,
        platform_key_config_ref: this.toSecretRef(body.platformKey || body.platform_key, '平台公钥') || null,
        notify_url: String(body.notifyUrl || body.notify_url).trim(),
        refund_policy: body.refundPolicy || body.refund_policy || null,
        remark: body.remark || null,
        status: 'draft',
        created_by: user.id,
        payment_account_campuses: this.campusLinks(body),
      },
      include: { payment_account_campuses: true },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'payment_account.create',
      resourceType: 'payment_account', resourceId: account.id, result: 'success',
      requestId, ip, metadata: { name: account.name, environment: account.environment },
    });
    return this.mask(account);
  }

  async update(
    user: AdminUserInfo, id: string, rawBody: Record<string, any>,
    keyFile: Express.Multer.File | undefined,
    requestId: string, ip: string,
  ) {
    const existing = await this.prisma.paymentAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '支付账户不存在' });
    const body = this.parseFields(rawBody);

    const data: any = { updated_by: user.id };
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.environment !== undefined) data.environment = body.environment;
    if (body.appId !== undefined || body.app_id !== undefined) data.app_id = String(body.appId ?? body.app_id).trim();
    if (body.mchId !== undefined || body.mch_id !== undefined) data.mch_id = String(body.mchId ?? body.mch_id).trim();
    if (body.merchantCertSerial !== undefined || body.merchant_cert_serial !== undefined) {
      data.merchant_cert_serial = body.merchantCertSerial ?? body.merchant_cert_serial ?? null;
    }
    if (body.notifyUrl !== undefined || body.notify_url !== undefined) {
      data.notify_url = String(body.notifyUrl ?? body.notify_url).trim();
    }
    if (body.refundPolicy !== undefined || body.refund_policy !== undefined) {
      data.refund_policy = body.refundPolicy ?? body.refund_policy ?? null;
    }
    if (body.remark !== undefined) data.remark = body.remark || null;
    if (keyFile?.buffer) data.private_key_secret_ref = this.toSecretRef(keyFile.buffer.toString('utf8'), '商户私钥');
    const apiv3 = this.toSecretRef(body.apiv3Secret ?? body.apiv3_secret, 'APIv3 密钥');
    if (apiv3 !== undefined) data.apiv3_secret_ref = apiv3;
    const plat = this.toSecretRef(body.platformKey ?? body.platform_key, '平台公钥');
    if (plat !== undefined) data.platform_key_config_ref = plat;

    // 启用中账户的关键字段变更 → 回退为草稿，需重新 validate + activate
    const criticalChanged = data.app_id !== undefined || data.mch_id !== undefined ||
      data.private_key_secret_ref !== undefined || data.apiv3_secret_ref !== undefined;
    if (criticalChanged && existing.status === 'active') {
      data.status = 'draft';
      data.last_validated_at = null;
      data.last_validation_result = null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (body.scopeType !== undefined || body.campusIds !== undefined || body.campus_ids !== undefined) {
        await tx.paymentAccountCampus.deleteMany({ where: { payment_account_id: id } });
        const links = this.campusLinks(body);
        if (links.create.length > 0) {
          await tx.paymentAccountCampus.createMany({
            data: links.create.map((l: any) => ({ payment_account_id: id, campus_id: l.campus_id })),
          });
        }
      }
      return tx.paymentAccount.update({
        where: { id },
        data,
        include: { payment_account_campuses: true },
      });
    });

    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'payment_account.update',
      resourceType: 'payment_account', resourceId: id, result: 'success',
      requestId, ip, metadata: criticalChanged ? { reset_to_draft: true } : {},
    });
    return this.mask(updated);
  }

  private validateBasicFields(body: Record<string, any>, isCreate: boolean) {
    const required = ['name', 'environment', 'notifyUrl'];
    for (const f of required) {
      if (isCreate && (body[f] === undefined || body[f] === '' || body[f] === null)) {
        throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: `缺少必填字段：${f}` });
      }
    }
    if (body.environment && !['test', 'production'].includes(body.environment)) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: 'environment 仅支持 test/production' });
    }
  }

  private campusLinks(body: Record<string, any>): any {
    const scopeType = body.scopeType ?? body.scope_type;
    const campusIds: string[] = body.campusIds ?? body.campus_ids ?? [];
    if (scopeType === 'campuses' && Array.isArray(campusIds) && campusIds.length > 0) {
      return { create: campusIds.map((campus_id) => ({ campus_id })) };
    }
    return { create: [] };
  }

  // ─── 自检（启用前检查） ───

  async validate(user: AdminUserInfo, id: string, requestId: string, ip: string) {
    const account = await this.prisma.paymentAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '支付账户不存在' });

    const checks: Array<{ name: string; passed: boolean; message?: string }> = [];
    const check = (name: string, passed: boolean, message?: string) => {
      checks.push({ name, passed, message });
    };

    check('基本信息完整', !!(account.app_id && account.mch_id && account.notify_url),
      account.app_id && account.mch_id ? undefined : '缺少 app_id / mch_id / notify_url');
    check('商户证书序列号已配置', !!account.merchant_cert_serial);

    // 密钥引用可解析
    for (const [label, ref] of [
      ['商户私钥', account.private_key_secret_ref],
      ['APIv3 密钥', account.apiv3_secret_ref],
      ['平台公钥', account.platform_key_config_ref],
    ] as Array<[string, string | null]>) {
      try {
        const plain = this.crypto.resolveSecretRef(ref, label);
        if (label === '商户私钥') {
          check(`${label}为有效 PEM`, /BEGIN (.*)PRIVATE KEY/.test(plain), /BEGIN (.*)PRIVATE KEY/.test(plain) ? undefined : '不是有效的 PEM 私钥');
        } else if (label === 'APIv3 密钥') {
          check(`${label}长度合规`, plain.length === 32, plain.length === 32 ? undefined : `长度 ${plain.length}，应为 32 字符`);
        } else {
          check(`${label}为有效 PEM`, /BEGIN (.*)PUBLIC KEY/.test(plain), /BEGIN (.*)PUBLIC KEY/.test(plain) ? undefined : '不是有效的 PEM 公钥');
        }
      } catch (e: any) {
        check(`${label}可解析`, false, e.message);
      }
    }

    // 真实模式可尝试拉取微信平台证书（结构预留；无网络/无真实商户时跳过）
    const isMock = (process.env.WECHAT_PAY_MODE || 'mock') === 'mock';
    if (!isMock && account.environment === 'production') {
      check('微信平台证书拉取', false, '真实模式证书拉取待接入真实商户号后实现');
    } else {
      check('微信平台连通性', true, isMock ? 'Mock 模式：跳过真实连通性检查' : '测试环境：跳过');
    }

    const ok = checks.every((c) => c.passed);
    await this.prisma.paymentAccount.update({
      where: { id },
      data: {
        last_validated_at: new Date(),
        last_validation_result: ok ? '全部通过' : checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.message || '失败'}`).join('; '),
        status: ok ? 'testing' : account.status,
      },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'payment_account.validate',
      resourceType: 'payment_account', resourceId: id, result: ok ? 'success' : 'fail',
      requestId, ip, metadata: { passed: checks.filter((c) => c.passed).length, total: checks.length },
    });
    return { ok, checks };
  }

  // ─── 启用 / 停用 ───

  async activate(user: AdminUserInfo, id: string, requestId: string, ip: string) {
    const account = await this.prisma.paymentAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '支付账户不存在' });
    if (account.status === 'active') return this.mask(account);
    // 启用前必须通过自检
    if (!account.last_validated_at || !account.last_validation_result?.startsWith('全部通过')) {
      throw new BadRequestException({ code: 'ERR_ACCOUNT_NOT_VALIDATED', message: '启用前请先通过自检（validate）' });
    }
    const updated = await this.prisma.paymentAccount.update({
      where: { id },
      data: { status: 'active', updated_by: user.id },
      include: { payment_account_campuses: true },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'payment_account.activate',
      resourceType: 'payment_account', resourceId: id, result: 'success', requestId, ip,
    });
    return this.mask(updated);
  }

  async disable(user: AdminUserInfo, id: string, requestId: string, ip: string) {
    const account = await this.prisma.paymentAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '支付账户不存在' });
    const updated = await this.prisma.paymentAccount.update({
      where: { id },
      data: { status: 'disabled', updated_by: user.id },
      include: { payment_account_campuses: true },
    });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'payment_account.disable',
      resourceType: 'payment_account', resourceId: id, result: 'success', requestId, ip,
    });
    return this.mask(updated);
  }

  async remove(user: AdminUserInfo, id: string, requestId: string, ip: string) {
    const account = await this.prisma.paymentAccount.findUnique({
      where: { id },
      include: { payment_orders: { take: 1 } },
    });
    if (!account) throw new NotFoundException({ code: 'ERR_NOT_FOUND', message: '支付账户不存在' });
    if (account.status === 'active') {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '启用中的账户不能删除，请先停用' });
    }
    if (account.payment_orders.length > 0) {
      throw new BadRequestException({ code: 'ERR_BAD_REQUEST', message: '已有支付订单的账户不能删除' });
    }
    await this.prisma.paymentAccount.delete({ where: { id } });
    await this.audit.log({
      actorType: 'admin', actorId: user.id, action: 'payment_account.delete',
      resourceType: 'payment_account', resourceId: id, result: 'success', requestId, ip,
    });
    return { deleted: true };
  }
}
