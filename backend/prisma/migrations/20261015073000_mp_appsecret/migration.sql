-- 小程序 AppSecret 加密存储（用于 code 换 openid）
ALTER TABLE "payment_accounts" ADD COLUMN "app_secret_ref" TEXT;
