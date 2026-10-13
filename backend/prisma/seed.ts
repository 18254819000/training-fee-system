// 种子数据：幂等（可重复执行）
// 包含：角色/超管/校区/收费期/课程与价格/学员+登录码/Mock 支付账户/示例账单
// 登录码明文仅在控制台输出一次，请妥善分发
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}
function generateLoginCode(bytes = 16): string {
  return randomHex(bytes).replace(/(.{4})/g, '$1-').replace(/-$/, '');
}
function hashLoginCode(code: string): string {
  const pepper = process.env.LOGIN_CODE_PEPPER || 'dev-only-pepper-change-me';
  const normalized = code.replace(/-/g, '').toLowerCase();
  return crypto.createHmac('sha256', pepper).update(normalized).digest('hex');
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
      permissions: ['campus:read', 'student:read', 'student:write', 'student:import', 'login-code:manage', 'fee-item:read', 'invoice:read', 'invoice:generate', 'report:read'],
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

  // ─── 4. 收费期（2026 年秋季） ───
  const period = await prisma.feePeriod.upsert({
    where: { code: 'PERIOD-2026-AUTUMN' },
    update: {},
    create: {
      code: 'PERIOD-2026-AUTUMN',
      name: '2026 年秋季学期',
      start_date: new Date('2026-09-01'),
      end_date: new Date('2026-12-31'),
      status: 'open',
      fee_period_campuses: {
        create: Object.values(campuses).map((campus_id) => ({ campus_id })),
      },
    },
  });
  console.log('  ✓ 收费期：2026 年秋季学期');

  // ─── 5. 课程 / 收费项目 / 校区价格 ───
  const course = await prisma.course.upsert({
    where: { code: 'COURSE-JP' },
    update: {},
    create: { code: 'COURSE-JP', name: '日语综合课程', description: '兴趣 / JLPT 考级方向', status: 'active' },
  });
  const feeItemDefs = [
    { code: 'FEE-JP-N5', name: '日语 N5 班（学期）', price: 280000 }, // 2800.00 元
    { code: 'FEE-JP-N4', name: '日语 N4 班（学期）', price: 320000 },
    { code: 'FEE-MATERIAL', name: '教材费', price: 18000 },
  ];
  for (const f of feeItemDefs) {
    const item = await prisma.feeItem.upsert({
      where: { code: f.code },
      update: { name: f.name },
      create: { code: f.code, name: f.name, course_id: course.id, status: 'active' },
    });
    for (const campusId of Object.values(campuses)) {
      const existing = await prisma.campusFeePrice.findFirst({
        where: { fee_item_id: item.id, campus_id: campusId, effective_to: null },
      });
      if (!existing) {
        await prisma.campusFeePrice.create({
          data: {
            fee_item_id: item.id, campus_id: campusId,
            amount_fen: BigInt(f.price),
            effective_from: new Date('2026-01-01'),
            created_by: admin.id,
          },
        });
      }
    }
  }
  console.log('  ✓ 收费项目 3 个（含校区价格）');

  // ─── 6. 学员 + 登录码 ───
  const studentDefs = [
    { student_no: 'S2026001', name: '张小明', campus: 'CAMPUS-HQ', grade_or_class: '高一（3）班' },
    { student_no: 'S2026002', name: '李小红', campus: 'CAMPUS-HQ', grade_or_class: '高二（1）班' },
    { student_no: 'S2026003', name: '王小刚', campus: 'CAMPUS-EAST', grade_or_class: '高一（5）班' },
    { student_no: 'S2026004', name: '赵小丽', campus: 'CAMPUS-EAST', grade_or_class: '高三（2）班' },
    { student_no: 'S2026005', name: '刘小强', campus: 'CAMPUS-HQ', grade_or_class: '高二（4）班' },
  ];
  const plainCodes: Array<{ name: string; code: string }> = [];
  for (const s of studentDefs) {
    const campusId = campuses[s.campus];
    const student = await prisma.student.upsert({
      where: { campus_id_student_no: { campus_id: campusId, student_no: s.student_no } },
      update: { name: s.name, grade_or_class: s.grade_or_class },
      create: {
        student_no: s.student_no, name: s.name,
        campus_id: campusId, grade_or_class: s.grade_or_class,
        status: 'active',
      },
    });
    // 撤销旧码，签发新码（90 天有效）
    await prisma.loginCode.updateMany({
      where: { student_id: student.id, used_at: null, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    const code = generateLoginCode(16);
    await prisma.loginCode.create({
      data: {
        student_id: student.id,
        code_hash: hashLoginCode(code),
        expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000),
        issued_by: admin.id,
      },
    });
    plainCodes.push({ name: s.name, code });
  }
  console.log('  ✓ 学员 5 人（登录码已签发）');

  // ─── 7. Mock 支付账户（启用） ───
  const mockAccount = await prisma.paymentAccount.upsert({
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

  // ─── 8. 示例账单（第 1 位学员，N5 班 + 教材费） ───
  const s1 = await prisma.student.findUnique({
    where: { campus_id_student_no: { campus_id: campuses['CAMPUS-HQ'], student_no: 'S2026001' } },
  });
  const n5 = await prisma.feeItem.findUnique({ where: { code: 'FEE-JP-N5' } });
  const mat = await prisma.feeItem.findUnique({ where: { code: 'FEE-MATERIAL' } });
  const priceN5 = await prisma.campusFeePrice.findFirst({
    where: { fee_item_id: n5!.id, campus_id: s1!.campus_id, effective_to: null },
  });
  const priceMat = await prisma.campusFeePrice.findFirst({
    where: { fee_item_id: mat!.id, campus_id: s1!.campus_id, effective_to: null },
  });
  const totalFen = Number(priceN5!.amount_fen) + Number(priceMat!.amount_fen);
  const existingInvoice = await prisma.invoice.findFirst({
    where: { student_id: s1!.id, fee_period_id: period.id, status: { not: 'voided' } },
  });
  if (!existingInvoice) {
    await prisma.invoice.create({
      data: {
        invoice_no: `INV2026${randomHex(4).toUpperCase()}`,
        student_id: s1!.id, campus_id: s1!.campus_id, fee_period_id: period.id,
        amount_due_fen: BigInt(totalFen), status: 'pending', created_by: admin.id,
        invoice_items: {
          create: [
            {
              fee_item_id: n5!.id, item_name_snapshot: n5!.name,
              unit_price_fen: priceN5!.amount_fen, quantity: 1, line_amount_fen: priceN5!.amount_fen,
            },
            {
              fee_item_id: mat!.id, item_name_snapshot: mat!.name,
              unit_price_fen: priceMat!.amount_fen, quantity: 1, line_amount_fen: priceMat!.amount_fen,
            },
          ],
        },
      },
    });
    console.log(`  ✓ 示例账单（${(totalFen / 100).toFixed(2)} 元）`);
  }

  console.log('\n✅ 种子数据完成\n');
  console.log('⚠️  登录码明文（仅显示一次，请妥善分发）：');
  for (const c of plainCodes) {
    console.log(`   ${c.name}: ${c.code}`);
  }
  console.log(`\n超管登录：admin / ${process.env.SEED_ADMIN_PASSWORD ? '(见 SEED_ADMIN_PASSWORD)' : adminPassword}`);
}

main()
  .catch((e) => {
    console.error('❌ 种子数据失败', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
