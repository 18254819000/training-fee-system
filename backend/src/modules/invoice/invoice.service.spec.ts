import { InvoiceService } from './invoice.service';

// 账单批量生成(新链路):校区 → 收费期 → 收费项目 → 预览 → 生成
// - 收费期只属于一个校区;收费项目直挂校区与价格;学生绑定一个收费项目
// - 本期已有账单 / 未绑定项目 / 项目不在本期的学生记入 skipped 并给出原因
// - 并发唯一冲突(P2002)兜底跳过(验收 F-11)
describe('InvoiceService.generate 新链路', () => {
  const user: any = { id: 'admin1', username: 'admin', roles: ['super_admin'], permissions: ['*'], campusIds: [] };

  const makeService = () => {
    const students = [
      { id: 's1', name: 'ZhangSan', campus_id: 'c1', fee_item_id: 'f1' }, // 正常 -> 生成
      { id: 's2', name: 'LiSi', campus_id: 'c1', fee_item_id: 'f1' }, // 本期已有账单 -> skipped
      { id: 's3', name: 'WangWu', campus_id: 'c1', fee_item_id: null }, // 未绑定 -> skipped
      { id: 's4', name: 'ZhaoLiu', campus_id: 'c1', fee_item_id: 'f2' }, // 绑定项目不在本期 -> skipped
    ];
    const tx: any = {
      invoice: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'inv-' + data.student_id, invoice_no: 'INV001' }),
        ),
      },
    };
    const prisma: any = {
      campus: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', name: 'Campus1', status: 'active' }),
      },
      feePeriod: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1', name: 'Autumn', status: 'open', campus_id: 'c1',
          fee_item_periods: [{ fee_item: { id: 'f1', name: 'N5 Class', status: 'active', amount_fen: BigInt(280000) } }],
        }),
      },
      student: { findMany: jest.fn().mockResolvedValue(students) },
      invoice: {
        findMany: jest.fn().mockResolvedValue([{ student_id: 's2' }]),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const crypto: any = { randomHex: jest.fn(() => 'abcdef') };
    const scope: any = { assertCampus: jest.fn(), scopeFilter: jest.fn().mockReturnValue(undefined) };
    const idempotency: any = { execute: jest.fn((_s: string, _k: string, _t: number, fn: any) => fn().then((result: any) => ({ result, replayed: false }))) };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new InvoiceService(prisma, crypto, scope, idempotency, audit);
    return { service, tx, prisma };
  };

  it('只为绑定了本期项目的学生生成;已有账单/未绑定/项目不在本期记入 skipped', async () => {
    const { service, tx } = makeService();
    const res: any = await service.generate(
      user, { fee_period_id: 'p1', campus_id: 'c1' } as any, 'req-1', '127.0.0.1',
    );
    expect(res.preview).toBe(false);
    expect(res.count).toBe(1);
    expect(tx.invoice.create).toHaveBeenCalledTimes(1);
    const createdData = tx.invoice.create.mock.calls[0][0].data;
    expect(createdData.student_id).toBe('s1');
    expect(createdData.campus_id).toBe('c1');
    expect(createdData.amount_due_fen).toBe(BigInt(280000));
    expect(res.skipped_count).toBe(3);
    const reasons = Object.fromEntries(res.skipped.map((s: any) => [s.student_id, s.reason]));
    expect(reasons['s2']).toBe('本期已有账单');
    expect(reasons['s3']).toBe('未绑定收费项目');
    expect(reasons['s4']).toBe('绑定的收费项目不在本收费期内');
    expect(res.skipped_student_ids).toEqual(expect.arrayContaining(['s2', 's3', 's4']));
  });

  it('preview 不写库,返回 groups/students/skipped 结构', async () => {
    const { service, tx } = makeService();
    const res: any = await service.preview(user, { fee_period_id: 'p1', campus_id: 'c1', preview: true } as any);
    expect(res.preview).toBe(true);
    expect(res.count).toBe(1);
    expect(res.total_fen).toBe(280000);
    expect(res.campus).toMatchObject({ id: 'c1' });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]).toMatchObject({ fee_item_id: 'f1', fee_item_name: 'N5 Class', amount_fen: 280000, count: 1 });
    expect(res.students[0]).toMatchObject({ student_id: 's1', fee_item_name: 'N5 Class', amount_fen: 280000 });
    expect(res.skipped).toHaveLength(3);
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  it('收费期未绑定任何项目时直接报错', async () => {
    const { service, prisma } = makeService();
    prisma.feePeriod.findUnique.mockResolvedValue({
      id: 'p1', name: 'Autumn', status: 'open', campus_id: 'c1', fee_item_periods: [],
    });
    await expect(service.generate(user, { fee_period_id: 'p1', campus_id: 'c1' } as any, 'req-1', '127.0.0.1'))
      .rejects.toMatchObject({ response: { code: 'ERR_NO_FEE_ITEMS' } });
  });

  it('收费期不属于所选校区时报错', async () => {
    const { service, prisma } = makeService();
    prisma.feePeriod.findUnique.mockResolvedValue({
      id: 'p1', name: 'Autumn', status: 'open', campus_id: 'c2',
      fee_item_periods: [{ fee_item: { id: 'f1', name: 'N5 Class', status: 'active', amount_fen: BigInt(280000) } }],
    });
    await expect(service.generate(user, { fee_period_id: 'p1', campus_id: 'c1' } as any, 'req-1', '127.0.0.1'))
      .rejects.toMatchObject({ response: { code: 'ERR_PERIOD_CAMPUS_MISMATCH' } });
  });

  it('所选收费项目不在本期绑定范围内时报错', async () => {
    const { service } = makeService();
    await expect(service.generate(
      user, { fee_period_id: 'p1', campus_id: 'c1', fee_item_ids: ['fX'] } as any, 'req-1', '127.0.0.1',
    )).rejects.toMatchObject({ response: { code: 'ERR_FEE_ITEM_NOT_IN_PERIOD' } });
  });

  it('批量生成走幂等通道(scope=invoice-batch,携带调用方幂等键)', async () => {
    const { service } = makeService();
    const calls: any[] = [];
    (service as any).idempotency.execute = jest.fn((_s: string, _k: string, _t: number, fn: any) => {
      calls.push([_s, _k]);
      return fn().then((result: any) => ({ result, replayed: false }));
    });
    await service.generate(user, { fee_period_id: 'p1', campus_id: 'c1', idempotency_key: 'k-123' } as any, 'req-1', '127.0.0.1');
    expect(calls[0][0]).toBe('invoice-batch');
    expect(calls[0][1]).toBe('k-123');
  });
});
