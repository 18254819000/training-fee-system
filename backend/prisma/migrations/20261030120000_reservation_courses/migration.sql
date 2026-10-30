-- 预约课程与预约订单；支付订单兼容课程支付（invoice_id 改可空 + reservation_order_id）
CREATE TABLE "reservation_courses" (
    "id" TEXT NOT NULL,
    "campus_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "amount_fen" BIGINT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "CampusStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reservation_courses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reservation_courses_campus_id_idx" ON "reservation_courses"("campus_id");
ALTER TABLE "reservation_courses" ADD CONSTRAINT "reservation_courses_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "reservation_orders" (
    "id" TEXT NOT NULL,
    "order_no" VARCHAR(40) NOT NULL,
    "student_id" TEXT NOT NULL,
    "campus_id" TEXT NOT NULL,
    "reservation_course_id" TEXT NOT NULL,
    "course_name_snapshot" VARCHAR(100) NOT NULL,
    "amount_fen" BIGINT NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reservation_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reservation_orders_order_no_key" ON "reservation_orders"("order_no");
CREATE INDEX "reservation_orders_student_id_idx" ON "reservation_orders"("student_id");
CREATE INDEX "reservation_orders_reservation_course_id_idx" ON "reservation_orders"("reservation_course_id");
ALTER TABLE "reservation_orders" ADD CONSTRAINT "reservation_orders_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reservation_orders" ADD CONSTRAINT "reservation_orders_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reservation_orders" ADD CONSTRAINT "reservation_orders_reservation_course_id_fkey" FOREIGN KEY ("reservation_course_id") REFERENCES "reservation_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 支付订单：账单支付与课程支付二选一
ALTER TABLE "payment_orders" ALTER COLUMN "invoice_id" DROP NOT NULL;
ALTER TABLE "payment_orders" ADD COLUMN "reservation_order_id" TEXT;
CREATE INDEX "payment_orders_reservation_order_id_idx" ON "payment_orders"("reservation_order_id");
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_reservation_order_id_fkey" FOREIGN KEY ("reservation_order_id") REFERENCES "reservation_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
