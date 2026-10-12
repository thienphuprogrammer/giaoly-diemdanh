ALTER TABLE "push_subscriptions" ADD COLUMN "auth_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Dọn lịch học nửa vời (chỉ có thứ hoặc chỉ có giờ; ứng dụng không tạo ra, phòng dữ liệu sửa tay) trước khi thêm CHECK,
-- để migration an toàn trên dữ liệu có sẵn: lịch thiếu một nửa = chưa đặt lịch (không nhắc).
UPDATE "classes" SET "meets_on" = NULL, "meets_at" = NULL WHERE ("meets_on" IS NULL) <> ("meets_at" IS NULL);--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_schedule_both_or_neither" CHECK (("classes"."meets_on" is null) = ("classes"."meets_at" is null));