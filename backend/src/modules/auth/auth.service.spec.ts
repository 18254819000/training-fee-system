import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

// 登录码兑换单测：统一失败文案、单次使用、过期校验（验收 F-07）
describe('AuthService.exchangeCode', () => {
  const makeService = (loginCodeRecord: any) => {
    const prisma: any = {
      loginCode: {
        findUnique: jest.fn().mockResolvedValue(loginCodeRecord),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const crypto: any = { hashLoginCode: jest.fn((c: string) => `hash:${c}`), randomHex: jest.fn(() => 'tok') };
    const redis: any = { set: jest.fn().mockResolvedValue(undefined) };
    const rateLimit: any = { hit: jest.fn().mockResolvedValue(true) };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const jwt: any = {};
    const service = new AuthService(prisma, jwt, crypto, rateLimit, redis, audit);
    return { service, prisma };
  };

  const validRecord = (): any => ({
    id: 'lc1', student_id: 's1', used_at: null, revoked_at: null,
    expires_at: new Date(Date.now() + 3600_000), failed_attempts: 0,
    student: { id: 's1', name: '张三', status: 'active', campus: { name: '总校区' }, grade_or_class: '高一' },
  });

  it('有效登录码兑换成功，返回 exchangeToken', async () => {
    const { service } = makeService(validRecord());
    const res: any = await service.exchangeCode({ code: 'abcd-1234' } as any, '127.0.0.1', 'req-1');
    expect(res.exchange_token).toBeDefined();
    expect(res.student.name).toBeDefined();
  });

  it('不存在的登录码返回统一失败文案（不透露是否存在）', async () => {
    const { service } = makeService(null);
    await expect(service.exchangeCode({ code: 'nope' } as any, '127.0.0.1', 'req-1'))
      .rejects.toMatchObject({ response: { code: 'ERR_INVALID_CODE' } });
  });

  it('已使用的登录码不可再次兑换（单次使用）', async () => {
    const rec = validRecord();
    rec.used_at = new Date();
    const { service, prisma } = makeService(rec);
    await expect(service.exchangeCode({ code: 'used' } as any, '127.0.0.1', 'req-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    // 失败计数 +1（失败限流）
    expect(prisma.loginCode.update).toHaveBeenCalled();
  });

  it('过期的登录码不可兑换', async () => {
    const rec = validRecord();
    rec.expires_at = new Date(Date.now() - 1000);
    const { service } = makeService(rec);
    await expect(service.exchangeCode({ code: 'expired' } as any, '127.0.0.1', 'req-1'))
      .rejects.toMatchObject({ response: { code: 'ERR_INVALID_CODE' } });
  });

  it('失败次数超限的登录码被锁定', async () => {
    const rec = validRecord();
    rec.failed_attempts = 10;
    const { service } = makeService(rec);
    await expect(service.exchangeCode({ code: 'locked' } as any, '127.0.0.1', 'req-1'))
      .rejects.toMatchObject({ response: { code: 'ERR_INVALID_CODE' } });
  });
});
