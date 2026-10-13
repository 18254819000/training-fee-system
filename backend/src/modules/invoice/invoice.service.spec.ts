import { InvoiceService } from './invoice.service';

// 账单批量生成防重：唯一冲突（学生+收费期已有账单）→ 跳过并明确提示，不抛错（验收 F-11）
describe('InvoiceService.generate 批量防重', () => {
  const user: any = { id: 'admin1', username: 'admin', roles: ['super_admin'], permissions: ['*'], campusIds: [] };

  const makeService = () => {
    const students = [
      { id: 's1', name: '张三', campus_id: 'c1' },
      { id: 's2', name: '李四', campus_id: 'c1' }, // 已有账单 → P2002
    ];
    const tx: any = {
      invoice: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          if (data.student_id === 's2') {
            const e: any = new Error('Unique constraint failed');
            e.code = 'P2002';
            throw e;
          }
          return Promise.resolve({ id: `inv-${data.student_id}`, invoice_no: 'INV001' });
        }),
      },
    };
    const prisma: any = {
      feePeriod: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', name: '秋季', status: 'open', fee_period_campuses: [] }) },
      student: { findMany: jest.fn().mockResolvedValue(students) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const crypto: any = { randomHex: jest.fn(() => 'abcdef') };
    const scope: any = { assertCampus: jest.fn(), scopeFilter: jest.fn().mockReturnValue(undefined) };
    const idempotency: any = { execute: jest.fn((_s: string, _k: string, _t: number, fn: any) => fn().then((result: any) => ({ result, replayed: false }))) };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const courseService: any = {
      getEffectivePrices: jest.fn().mockResolvedValue([
        { fee_item_id: 'f1', fee_item: { name: 'N5 班' }, amount_fen: BigInt(280000) },
      ]),
    };
    const service = new InvoiceService(prisma, crypto, scope, idempotency, audit, courseService);
    return { service, tx };
  };

  it('已有账单的学生被跳过（skipped），其余正常创建', async () => {
    const { service } = makeService();
    const res: any = await service.generate(
      user, { fee_period_id: 'p1', student_ids: ['s1', 's2'] } as any, 'req-1', '127.0.0.1',
    );
    expect(res.count).toBe(1);
    expect(res.skipped_count).toBe(1);
    expect(res.skipped_student_ids).toContain('s2');
    expect(res.preview).toBe(false);
  });

  it('批量生成走幂等通道（scope=invoice-batch，携带调用方幂等键）', async () => {
    const { service } = makeService();
    // 重新构造以捕获 idempotency 参数
    const calls: any[] = [];
    (service as any).idempotency.execute = jest.fn((_s: string, _k: string, _t: number, fn: any) => {
      calls.push([_s, _k]);
      return fn().then((result: any) => ({ result, replayed: false }));
    });
    await service.generate(user, { fee_period_id: 'p1', student_ids: ['s1'], idempotency_key: 'k-123' } as any, 'req-1', '127.0.0.1');
    expect(calls[0][0]).toBe('invoice-batch');
    expect(calls[0][1]).toBe('k-123');
  });
});
