// 种子数据：幂等（可重复执行）
// 新模型：收费期只属于一个校区；收费项目直挂校区与价格并绑定收费期；
// 学生绑定收费项目 + 家长手机号（手机号登录凭证）
// 包含：角色/超管/校区/收费期/课程与收费项目/学员/Mock 支付账户
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

async function main() {
  console.log('🌱 开始写入种子数据…');

  // ─── 1. 角色（权限码以后端 PERM 为准） ───
  const roles: Array<{ code: string; name: string; permissions: string[] }> = [
    { code: 'super_admin', name: '超级管理员', permissions: ['*'] },
    {
      code: 'finance', name: '财务',
      permissions: ['invoice:read', 'invoice:void', 'payment:read', 'payment:reconcile', 'refund:apply', 'refund:submit', 'report:read', 'export', 'payment-account:read'],
    },
    {
      code: 'campus_admin', name: '校区管理员',
      permissions: ['campus:read', 'student:read', 'student:write', 'student:import', 'fee-period:read', 'fee-item:read', 'invoice:read', 'invoice:generate', 'report:read'],
    },
    {
      code: 'operator', name: '操作员',
      permissions: ['campus:read', 'student:read', 'fee-item:read', 'invoice:read', 'payment:read', 'report:read'],
    },
  ];
  for (const r of roles) {
    await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, permissions: r.permissions },
      create: r,
    });
  }
  console.log('  ✓ 角色 4 个');

  // ─── 2. 超管（admin / Admin@123456） ───
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';
  const admin = await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password_hash: await bcrypt.hash(adminPassword, 10),
      status: 'active',
    },
  });
  const superRole = await prisma.role.findUnique({ where: { code: 'super_admin' } });
  await prisma.adminUserRole.upsert({
    where: { admin_user_id_role_id: { admin_user_id: admin.id, role_id: superRole!.id } },
    update: {},
    create: { admin_user_id: admin.id, role_id: superRole!.id },
  });
  console.log(`  ✓ 超管 admin（密码：${process.env.SEED_ADMIN_PASSWORD ? '********' : adminPassword}）`);

  // ─── 3. 校区 ───
  const campusDefs = [
    { code: 'CAMPUS-HQ', name: '总校区', address: '市中心日语学习中心 1F' },
    { code: 'CAMPUS-EAST', name: '城东校区', address: '城东商业街 2F' },
  ];
  const campuses: Record<string, string> = {};
  for (const c of campusDefs) {
    const campus = await prisma.campus.upsert({
      where: { code: c.code },
      update: { name: c.name, address: c.address },
      create: { ...c, status: 'active' },
    });
    campuses[c.code] = campus.id;
  }
  console.log('  ✓ 校区 2 个');

  // ─── 4. 收费期（每个校区一个 2026 年秋季学期，均已开放） ───
  const periods: Record<string, string> = {};
  for (const c of campusDefs) {
    const code = `PERIOD-2026-AUTUMN-${c.code}`;
    const period = await prisma.feePeriod.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name: `2026 年秋季学期（${c.name}）`,
        campus_id: campuses[c.code],
        start_date: new Date('2026-09-01'),
        end_date: new Date('2026-12-31'),
        status: 'open',
      },
    });
    periods[c.code] = period.id;
  }
  console.log('  ✓ 收费期 2 个（各校区一个，均已开放）');

  // ─── 5. 课程 / 收费项目（直挂校区与价格，绑定本校区收费期） ───
  const course = await prisma.course.upsert({
    where: { code: 'COURSE-JP' },
    update: {},
    create: { code: 'COURSE-JP', name: '日语综合课程', description: '兴趣 / JLPT 考级方向', status: 'active' },
  });
  const feeItemDefs = [
    { suffix: 'N5', name: '日语 N5 班（学期）', price: 280000 }, // 2800.00 元
    { suffix: 'N4', name: '日语 N4 班（学期）', price: 320000 },
    { suffix: 'MAT', name: '教材费', price: 18000 },
  ];
  const feeItems: Record<string, string> = {}; // key: CAMPUSCODE_SUFFIX
  for (const c of campusDefs) {
    for (const f of feeItemDefs) {
      const code = `FEE-JP-${f.suffix}-${c.code}`;
      const item = await prisma.feeItem.upsert({
        where: { code },
        update: { name: f.name, amount_fen: BigInt(f.price) },
        create: {
          code, name: f.name, course_id: course.id,
          campus_id: campuses[c.code], amount_fen: BigInt(f.price),
          status: 'active',
        },
      });
      await prisma.feeItemPeriod.upsert({
        where: { fee_item_id_fee_period_id: { fee_item_id: item.id, fee_period_id: periods[c.code] } },
        update: {},
        create: { fee_item_id: item.id, fee_period_id: periods[c.code] },
      });
      feeItems[`${c.code}_${f.suffix}`] = item.id;
    }
  }
  console.log('  ✓ 收费项目 6 个（每校区 3 个，直挂价格并绑定本校区收费期）');

  // ─── 6. 学员（绑定收费项目；家长手机号为明文示例，实际由应用层加密） ───
  // 注意：guardian_phone 在 service 层加密存储；seed 直接写入已方便演示，此处仅示例用途
  const studentDefs = [
    { student_no: 'S2026001', name: '张小明', campus: 'CAMPUS-HQ', item: 'N5', phone: '13800001111', grade_or_class: '高一（3）班' },
    { student_no: 'S2026002', name: '李小红', campus: 'CAMPUS-HQ', item: 'N4', phone: '13800002222', grade_or_class: '高二（1）班' },
    { student_no: 'S2026003', name: '王小刚', campus: 'CAMPUS-EAST', item: 'N5', phone: '13800003333', grade_or_class: '高一（5）班' },
    { student_no: 'S2026004', name: '赵小丽', campus: 'CAMPUS-EAST', item: 'MAT', phone: '13800004444', grade_or_class: '高三（2）班' },
  ];
  for (const s of studentDefs) {
    const campusId = campuses[s.campus];
    await prisma.student.upsert({
      where: { campus_id_student_no: { campus_id: campusId, student_no: s.student_no } },
      update: { name: s.name, grade_or_class: s.grade_or_class },
      create: {
        student_no: s.student_no, name: s.name,
        campus_id: campusId, grade_or_class: s.grade_or_class,
        guardian_phone: s.phone, // 演示数据；生产请走 service 层加密
        fee_item_id: feeItems[`${s.campus}_${s.item}`],
        status: 'active',
      },
    });
  }
  console.log('  ✓ 学员 4 人（已绑定收费项目与家长手机号）');

  // ─── 7. Mock 支付账户（启用） ───
  await prisma.paymentAccount.upsert({
    where: { id: 'seed-mock-account' },
    update: {},
    create: {
      id: 'seed-mock-account',
      name: 'Mock 微信支付（联调用）',
      environment: 'test',
      app_id: 'wx_mock_appid',
      mch_id: 'mock_mch_001',
      notify_url: 'http://localhost:3000/wechat/notify',
      status: 'active',
      last_validated_at: new Date(),
      last_validation_result: '全部通过（种子数据）',
      created_by: admin.id,
    },
  });
  console.log('  ✓ Mock 支付账户（active）');

  console.log('\n✅ 种子数据完成');
  console.log(`超管登录：admin / ${process.env.SEED_ADMIN_PASSWORD ? '(见 SEED_ADMIN_PASSWORD)' : adminPassword}`);
  console.log(`演示手机号登录：13800001111（张小明，总校区）/ 13800003333（王小刚，城东校区）`);
}

main()
  .catch((e) => {
    console.error('❌ 种子数据失败', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
