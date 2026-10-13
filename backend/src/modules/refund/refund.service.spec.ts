import { ConflictException, BadRequestException } from '@nestjs/common';
import { RefundService } from './refund.service';

// 退款防重：同一支付订单不允许存在进行中的退款单；一期仅全额退款（验收 F-20）
describe('RefundService.apply 退款防重', () => {
  const user: any = { id: 'admin1', username: 'admin', roles: ['finance'], permissions: ['*'], campusIds: [] };
  const paidOrder = {
    id: 'o1', status: 'paid', amount_fen: BigInt(280000), invoice_id: 'inv1',
    invoice: { id: 'inv1', campus_id: 'c1' },
  };

  const makeService = (existingRefund: any) => {
    const tx: any = {
      refund: { create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rf1', ...data })) },
      invoice: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      paymentOrder: { findUnique: jest.fn().mockResolvedValue(paidOrder) },
      // 模拟 Prisma where 语义：只返回状态在 ['created','submitted'] 的进行中退款单
      refund: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (!existingRefund) return Promise.resolve(null);
          const inProgress = where?.status?.in || [];
          return Promise.resolve(inProgress.includes(existingRefund.status) ? existingRefund : null);
        }),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const crypto: any = { randomHex: jest.fn(() => 'ab12cd') };
    const scope: any = { assertCampus: jest.fn(), scopeFilter: jest.fn() };
    const idempotency: any = { execute: jest.fn((_s: any, _k: any, _t: any, fn: any) => fn().then((r: any) => ({ result: r, replayed: false }))) };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const wechatPay: any = {};
    const service = new RefundService(prisma, crypto, scope, idempotency, audit, wechatPay);
    return { service, tx };
  };

  it('无进行中退款单时可申请全额退款', async () => {
    const { service, tx } = makeService(null);
    const res: any = await service.apply(user, 'o1', '家长申请退费', undefined, undefined, 'req-1', '127.0.0.1');
    expect(res.refund_no).toMatch(/^RF/);
    expect(tx.refund.create).toHaveBeenCalled();
    const data = tx.refund.create.mock.calls[0][0].data;
    expect(Number(data.amount_fen)).toBe(280000); // 全额
  });

  it('同一订单已有进行中退款单 → 409 防重', async () => {
    const { service } = makeService({ id: 'rf-old', status: 'submitted' });
    await expect(service.apply(user, 'o1', '重复申请', undefined, undefined, 'req-1', '127.0.0.1'))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('已终态（success）的退款单不阻塞新申请', async () => {
    const { service, tx } = makeService({ id: 'rf-old', status: 'success' });
    const res: any = await service.apply(user, 'o1', '再次申请', undefined, undefined, 'req-1', '127.0.0.1');
    expect(tx.refund.create).toHaveBeenCalled();
    expect(res).toBeDefined();
  });

  it('非全额金额被拒绝（一期仅全额退款）', async () => {
    const { service } = makeService(null);
    await expect(service.apply(user, 'o1', '部分退款', 10000, undefined, 'req-1', '127.0.0.1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('未支付订单不可申请退款', async () => {
    const { service } = makeService(null);
    (service as any).prisma.paymentOrder.findUnique = jest.fn().mockResolvedValue({ ...paidOrder, status: 'pending' });
    await expect(service.apply(user, 'o1', '未支付', undefined, undefined, 'req-1', '127.0.0.1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
