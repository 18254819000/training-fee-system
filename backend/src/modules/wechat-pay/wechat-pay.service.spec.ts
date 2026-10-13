import { WechatPayService } from './wechat-pay.service';
import { NotifyEvent } from './wechat-pay.adapter';

// 支付通知幂等：重复通知 / 并发重复入账只入账一次（验收 F-16）
describe('WechatPayService.applyPaidEvent 通知幂等', () => {
  const order = {
    id: 'o1', out_trade_no: 'TFS001', amount_fen: BigInt(280000), status: 'pending',
    invoice_id: 'inv1',
    invoice: { id: 'inv1', amount_due_fen: BigInt(280000), amount_paid_fen: BigInt(0) },
  };
  const event: NotifyEvent = {
    id: 'notif-1', eventType: 'TRANSACTION.SUCCESS', summary: '支付成功',
    outTradeNo: 'TFS001', transactionId: 'txn_001', tradeState: 'SUCCESS', amountFen: 280000,
  };

  const makeService = (overrides: any = {}) => {
    const state = { notifications: [] as any[], order: { ...order }, txCalls: 0 };
    const prisma: any = {
      paymentNotification: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          if (state.notifications.some((n) => n.notification_id === data.notification_id)) {
            const e: any = new Error('Unique constraint failed');
            e.code = 'P2002';
            throw e;
          }
          state.notifications.push(data);
          return Promise.resolve(data);
        }),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      paymentOrder: {
        findUnique: jest.fn().mockResolvedValue(state.order),
        update: jest.fn().mockImplementation(({ data }: any) => {
          Object.assign(state.order, data);
          return Promise.resolve(state.order);
        }),
      },
      invoice: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn: any) => {
        state.txCalls++;
        const tx: any = {
          paymentOrder: prisma.paymentOrder,
          invoice: prisma.invoice,
          paymentNotification: prisma.paymentNotification,
        };
        return fn(tx);
      }),
      ...overrides,
    };
    const crypto: any = { sha256: jest.fn(() => 'digest'), randomHex: jest.fn(() => 'ab12cd') };
    const scope: any = { assertCampus: jest.fn(), scopeFilter: jest.fn() };
    const idempotency: any = { execute: jest.fn((_s: any, _k: any, _t: any, fn: any) => fn().then((r: any) => ({ result: r, replayed: false }))) };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new WechatPayService(prisma, crypto, scope, idempotency, audit);
    return { service, state, prisma };
  };

  it('首次通知成功入账，订单变为 paid', async () => {
    const { service, state } = makeService();
    const res = await service.applyPaidEvent(event, 'digest-1', 'req-1');
    expect(res.code).toBe('SUCCESS');
    expect(state.order.status).toBe('paid');
    expect(state.txCalls).toBe(1);
  });

  it('重复通知（同一 notification_id）直接返回成功，不重复入账', async () => {
    const { service, state } = makeService();
    await service.applyPaidEvent(event, 'digest-1', 'req-1');
    const res = await service.applyPaidEvent(event, 'digest-1', 'req-2');
    expect(res).toEqual({ code: 'SUCCESS', message: '重复通知' });
    expect(state.txCalls).toBe(1); // 事务只执行一次
  });

  it('金额不一致的通知被拒绝并记录（防伪造金额，验收 F-17）', async () => {
    const { service, prisma } = makeService();
    const badEvent = { ...event, id: 'notif-2', amountFen: 1 };
    const res = await service.applyPaidEvent(badEvent, 'digest-2', 'req-1');
    expect(res).toEqual({ code: 'SUCCESS', message: '已拒绝' }); // 毒丸：停止微信重试
    expect(prisma.paymentNotification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { notification_id: 'notif-2' },
        data: expect.objectContaining({ processing_status: 'rejected', error_code: 'ERR_AMOUNT_MISMATCH' }),
      }),
    );
  });

  it('已入账订单收到重复通知直接成功（并发重放）', async () => {
    const { service, state } = makeService();
    state.order.status = 'paid'; // 已是终态
    const res = await service.applyPaidEvent({ ...event, id: 'notif-3' }, 'digest-3', 'req-1');
    expect(res.code).toBe('SUCCESS');
    expect(state.txCalls).toBe(0);
  });
});
