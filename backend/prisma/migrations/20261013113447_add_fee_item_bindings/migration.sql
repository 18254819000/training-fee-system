-- AlterTable
ALTER TABLE "students" ADD COLUMN     "fee_item_id" TEXT;

-- CreateTable
CREATE TABLE "fee_item_periods" (
    "fee_item_id" TEXT NOT NULL,
    "fee_period_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_item_periods_pkey" PRIMARY KEY ("fee_item_id","fee_period_id")
);

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_item_periods" ADD CONSTRAINT "fee_item_periods_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_item_periods" ADD CONSTRAINT "fee_item_periods_fee_period_id_fkey" FOREIGN KEY ("fee_period_id") REFERENCES "fee_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
