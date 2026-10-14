-- 支付账号密钥引用列改 TEXT：上传私钥文件加密后可达 2KB+，VarChar(255) 会溢出导致 500
ALTER TABLE "payment_accounts" ALTER COLUMN "private_key_secret_ref" TYPE TEXT;
ALTER TABLE "payment_accounts" ALTER COLUMN "apiv3_secret_ref" TYPE TEXT;
ALTER TABLE "payment_accounts" ALTER COLUMN "platform_key_config_ref" TYPE TEXT;
