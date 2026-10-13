// 全局配置：全部来自环境变量，仓库内不放任何真实密钥
export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL || '',
  },
  redis: {
    // 为空则降级为内存限流（开发/单机可用，生产建议配置 Redis）
    url: process.env.REDIS_URL || '',
  },

  jwt: {
    // 管理员登录 JWT 密钥（生产必须配置 32 字节以上随机值）
    secret: process.env.JWT_SECRET || 'dev-only-jwt-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  security: {
    // 登录码 HMAC  pepper：只存哈希，pepper 泄露=哈希可被暴力破解，生产必须配置
    loginCodePepper: process.env.LOGIN_CODE_PEPPER || 'dev-only-pepper-change-me',
    // 应用层字段加密主密钥（32 字节 hex），用于手机号等 PII 加密；不配则 PII 明文存储并打警告
    masterKey: process.env.MASTER_KEY || '',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
  },

  loginCode: {
    lengthBytes: 16, // 128 bit 熵
    ttlDays: parseInt(process.env.LOGIN_CODE_TTL_DAYS || '90', 10),
    maxFailedAttempts: parseInt(process.env.LOGIN_CODE_MAX_FAILED || '10', 10),
  },

  studentSession: {
    ttlDays: parseInt(process.env.STUDENT_SESSION_TTL_DAYS || '30', 10),
  },

  wechatPay: {
    // mock = 模拟适配器（无真实商户号时保证验收可测）；real = 真实微信支付 APIv3
    mode: process.env.WECHAT_PAY_MODE || 'mock',
  },

  files: {
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    exportDir: process.env.EXPORT_DIR || './exports',
    // 导入/导出文件保留天数（个人信息最小化：不长期保存原始文件）
    retentionDays: parseInt(process.env.FILE_RETENTION_DAYS || '7', 10),
  },
});
