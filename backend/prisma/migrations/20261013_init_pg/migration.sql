-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CampusStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "FeePeriodStatus" AS ENUM ('draft', 'open', 'closed');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('active', 'inactive', 'left');

-- CreateEnum
CREATE TYPE "GuardianStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('pending', 'processing', 'paid', 'refunding', 'refunded', 'voided');

-- CreateEnum
CREATE TYPE "PaymentOrderStatus" AS ENUM ('created', 'pending', 'paid', 'failed', 'closed');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('created', 'submitted', 'success', 'failed', 'closed');

-- CreateEnum
CREATE TYPE "PaymentAccountEnv" AS ENUM ('test', 'production');

-- CreateEnum
CREATE TYPE "PaymentAccountStatus" AS ENUM ('draft', 'testing', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('uploaded', 'previewed', 'committed', 'failed');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('pending', 'done', 'failed');

-- CreateEnum
CREATE TYPE "NotifyProcessingStatus" AS ENUM ('received', 'verified', 'processed', 'duplicate', 'rejected');

-- CreateTable
CREATE TABLE "campuses" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "address" VARCHAR(255),
    "contact_name" VARCHAR(80),
    "contact_phone" VARCHAR(32),
    "status" "CampusStatus" NOT NULL DEFAULT 'active',
    "remark" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_periods" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FeePeriodStatus" NOT NULL DEFAULT 'draft',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_period_campuses" (
    "fee_period_id" TEXT NOT NULL,
    "campus_id" TEXT NOT NULL,

    CONSTRAINT "fee_period_campuses_pkey" PRIMARY KEY ("fee_period_id","campus_id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "student_no" VARCHAR(64),
    "name" VARCHAR(100) NOT NULL,
    "campus_id" TEXT NOT NULL,
    "grade_or_class" VARCHAR(100),
    "guardian_phone" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_codes" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "issued_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "wechat_openid" TEXT,
    "status" "GuardianStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "student_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "relationship" VARCHAR(32),
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("student_id","guardian_id")
);

-- CreateTable
CREATE TABLE "student_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "student_ids" JSONB NOT NULL,
    "guardian_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" "CampusStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_items" (
    "id" TEXT NOT NULL,
    "course_id" TEXT,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" "CampusStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_fee_prices" (
    "id" TEXT NOT NULL,
    "fee_item_id" TEXT NOT NULL,
    "campus_id" VARCHAR(64) NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campus_fee_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_no" VARCHAR(40) NOT NULL,
    "invoice_type" VARCHAR(24) NOT NULL DEFAULT 'main',
    "student_id" TEXT NOT NULL,
    "campus_id" TEXT NOT NULL,
    "fee_period_id" TEXT NOT NULL,
    "amount_due_fen" BIGINT NOT NULL,
    "amount_paid_fen" BIGINT NOT NULL DEFAULT 0,
    "amount_refunded_fen" BIGINT NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'pending',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "fee_item_id" TEXT,
    "item_name_snapshot" VARCHAR(100) NOT NULL,
    "unit_price_fen" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "line_amount_fen" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "out_trade_no" VARCHAR(64) NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "payment_account_id" TEXT NOT NULL,
    "channel" VARCHAR(16) NOT NULL DEFAULT 'WECHAT',
    "amount_fen" BIGINT NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'created',
    "wechat_transaction_id" VARCHAR(64),
    "prepay_id" VARCHAR(128),
    "paid_at" TIMESTAMP(3),
    "last_query_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_notifications" (
    "id" TEXT NOT NULL,
    "notification_id" VARCHAR(128),
    "out_trade_no" VARCHAR(64) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "payload_digest" VARCHAR(128) NOT NULL,
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "processing_status" "NotifyProcessingStatus" NOT NULL DEFAULT 'received',
    "error_code" VARCHAR(64),
    "request_id" VARCHAR(64),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "refund_no" VARCHAR(64) NOT NULL,
    "payment_order_id" TEXT NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'created',
    "wechat_refund_id" VARCHAR(64),
    "requested_by" TEXT,
    "approved_by" TEXT,
    "success_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_accounts" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "environment" "PaymentAccountEnv" NOT NULL,
    "app_id" VARCHAR(64) NOT NULL,
    "mch_id" VARCHAR(32) NOT NULL,
    "merchant_cert_serial" VARCHAR(128),
    "private_key_secret_ref" VARCHAR(255),
    "apiv3_secret_ref" VARCHAR(255),
    "platform_key_config_ref" VARCHAR(255),
    "notify_url" VARCHAR(255) NOT NULL,
    "refund_policy" VARCHAR(500),
    "remark" VARCHAR(500),
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'draft',
    "last_validated_at" TIMESTAMP(3),
    "last_validation_result" VARCHAR(500),
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_account_campuses" (
    "payment_account_id" TEXT NOT NULL,
    "campus_id" TEXT NOT NULL,

    CONSTRAINT "payment_account_campuses_pkey" PRIMARY KEY ("payment_account_id","campus_id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "status" "AdminStatus" NOT NULL DEFAULT 'active',
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "permissions" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user_roles" (
    "admin_user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "admin_user_roles_pkey" PRIMARY KEY ("admin_user_id","role_id")
);

-- CreateTable
CREATE TABLE "admin_user_campuses" (
    "admin_user_id" TEXT NOT NULL,
    "campus_id" TEXT NOT NULL,

    CONSTRAINT "admin_user_campuses_pkey" PRIMARY KEY ("admin_user_id","campus_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_type" VARCHAR(16) NOT NULL,
    "actor_id" VARCHAR(64),
    "action" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(64),
    "resource_id" VARCHAR(64),
    "result" VARCHAR(16) NOT NULL,
    "request_id" VARCHAR(64),
    "ip_masked" VARCHAR(64),
    "metadata_redacted" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL DEFAULT 'student',
    "campus_id" TEXT,
    "fee_period_id" TEXT,
    "file_name" VARCHAR(255) NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'uploaded',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "preview_json" JSONB,
    "error_report_path" VARCHAR(500),
    "committed_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "params_json" JSONB,
    "file_path" VARCHAR(500),
    "status" "ExportJobStatus" NOT NULL DEFAULT 'pending',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "response_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campuses_code_key" ON "campuses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fee_periods_code_key" ON "fee_periods"("code");

-- CreateIndex
CREATE INDEX "students_campus_id_status_idx" ON "students"("campus_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "students_campus_id_student_no_key" ON "students"("campus_id", "student_no");

-- CreateIndex
CREATE UNIQUE INDEX "login_codes_code_hash_key" ON "login_codes"("code_hash");

-- CreateIndex
CREATE INDEX "login_codes_student_id_idx" ON "login_codes"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_sessions_token_hash_key" ON "student_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fee_items_code_key" ON "fee_items"("code");

-- CreateIndex
CREATE INDEX "campus_fee_prices_fee_item_id_campus_id_effective_from_effe_idx" ON "campus_fee_prices"("fee_item_id", "campus_id", "effective_from", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_no_key" ON "invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "invoices_campus_id_fee_period_id_status_idx" ON "invoices"("campus_id", "fee_period_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_student_id_fee_period_id_invoice_type_key" ON "invoices"("student_id", "fee_period_id", "invoice_type");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_out_trade_no_key" ON "payment_orders"("out_trade_no");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_wechat_transaction_id_key" ON "payment_orders"("wechat_transaction_id");

-- CreateIndex
CREATE INDEX "payment_orders_invoice_id_status_idx" ON "payment_orders"("invoice_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_notifications_notification_id_key" ON "payment_notifications"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_notifications_payload_digest_key" ON "payment_notifications"("payload_digest");

-- CreateIndex
CREATE INDEX "payment_notifications_out_trade_no_idx" ON "payment_notifications"("out_trade_no");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_refund_no_key" ON "refunds"("refund_no");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_wechat_refund_id_key" ON "refunds"("wechat_refund_id");

-- CreateIndex
CREATE INDEX "payment_accounts_environment_status_idx" ON "payment_accounts"("environment", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_key_key" ON "idempotency_keys"("key");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- AddForeignKey
ALTER TABLE "fee_period_campuses" ADD CONSTRAINT "fee_period_campuses_fee_period_id_fkey" FOREIGN KEY ("fee_period_id") REFERENCES "fee_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_period_campuses" ADD CONSTRAINT "fee_period_campuses_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_codes" ADD CONSTRAINT "login_codes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_fee_prices" ADD CONSTRAINT "campus_fee_prices_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fee_period_id_fkey" FOREIGN KEY ("fee_period_id") REFERENCES "fee_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_account_campuses" ADD CONSTRAINT "payment_account_campuses_payment_account_id_fkey" FOREIGN KEY ("payment_account_id") REFERENCES "payment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_account_campuses" ADD CONSTRAINT "payment_account_campuses_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_campuses" ADD CONSTRAINT "admin_user_campuses_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_campuses" ADD CONSTRAINT "admin_user_campuses_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

