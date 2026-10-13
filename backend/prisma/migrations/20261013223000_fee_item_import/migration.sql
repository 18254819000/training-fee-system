-- 收费项目内学生导入：导入任务关联收费项目
ALTER TABLE "import_jobs" ADD COLUMN "fee_item_id" TEXT;

ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "import_jobs_fee_item_id_idx" ON "import_jobs"("fee_item_id");
