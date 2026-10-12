-- Ghi chú: Postgres không cho DÙNG giá trị enum vừa thêm (ALTER TYPE ... ADD VALUE) trong cùng transaction với lệnh thêm.
-- drizzle migrate chạy mọi migration đang chờ trong MỘT transaction, nên không migration nào trong cùng đợt (kể cả các
-- bản sau 0008) được chèn/so sánh 'class' của audit_entity; chỉ code ứng dụng (nhật ký `class.schedule`) dùng nó sau khi migrate xong.
-- Các cột/bảng mới đều cho phép NULL hoặc có mặc định: an toàn trên dữ liệu có sẵn (lớp cũ = chưa có lịch, không nhắc).
ALTER TYPE "public"."audit_entity" ADD VALUE 'class';--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target_key" text NOT NULL,
	"user_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_kind_target_user_uq" UNIQUE NULLS NOT DISTINCT("kind","target_key","user_id")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_user_agent_len" CHECK ("push_subscriptions"."user_agent" is null or char_length("push_subscriptions"."user_agent") <= 200)
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "meets_on" smallint;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "meets_at" time;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_meets_on_range" CHECK ("classes"."meets_on" between 0 and 6);