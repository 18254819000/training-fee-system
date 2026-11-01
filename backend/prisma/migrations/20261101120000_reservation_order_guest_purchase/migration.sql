-- 预约课程独立购买：订单 student_id 改可空，新增购买人 guardian_id（不存明文手机号，购买人以 guardian 锚定）
ALTER TABLE "reservation_orders" ALTER COLUMN "student_id" DROP NOT NULL;
ALTER TABLE "reservation_orders" ADD COLUMN "guardian_id" TEXT;
CREATE INDEX "reservation_orders_guardian_id_idx" ON "reservation_orders"("guardian_id");
ALTER TABLE "reservation_orders" ADD CONSTRAINT "reservation_orders_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
