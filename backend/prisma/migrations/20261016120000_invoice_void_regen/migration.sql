-- 作废账单不再占用"一人一期一单"名额：删除普通唯一约束，改用部分唯一索引（仅非作废状态生效）
DROP INDEX IF EXISTS "invoices_student_id_fee_period_id_invoice_type_key";
CREATE UNIQUE INDEX "invoices_active_student_period_type_key"
  ON "invoices"("student_id", "fee_period_id", "invoice_type")
  WHERE "status" <> 'voided';
