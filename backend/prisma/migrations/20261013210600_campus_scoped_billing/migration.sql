-- 账单模型重构：收费期只绑定单个校区；收费项目直挂校区与价格
-- 注意：campus_fee_prices / fee_period_campuses 在重构前已被清空（仅保留 admin 账号），直接删表

-- 1) fee_periods 增加 campus_id（必填）
ALTER TABLE "fee_periods" ADD COLUMN "campus_id" TEXT NOT NULL;

-- 2) 删除收费期↔校区多对多关联表
DROP TABLE "fee_period_campuses";

-- 3) fee_items 增加 campus_id（必填）与 amount_fen（价格/分，必填）
ALTER TABLE "fee_items" ADD COLUMN "campus_id" TEXT NOT NULL;
ALTER TABLE "fee_items" ADD COLUMN "amount_fen" BIGINT NOT NULL DEFAULT 0;

-- 4) 删除校区价格表（价格已直挂收费项目）
DROP TABLE "campus_fee_prices";

-- 5) 外键
ALTER TABLE "fee_periods" ADD CONSTRAINT "fee_periods_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) 索引
CREATE INDEX "fee_periods_campus_id_idx" ON "fee_periods"("campus_id");
CREATE INDEX "fee_items_campus_id_idx" ON "fee_items"("campus_id");
