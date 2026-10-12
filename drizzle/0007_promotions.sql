-- Ghi chú: Postgres không cho DÙNG giá trị enum vừa thêm (ALTER TYPE ... ADD VALUE) trong cùng transaction với lệnh thêm.
-- drizzle migrate chạy mọi migration đang chờ trong MỘT transaction, nên không migration nào trong cùng đợt (kể cả các
-- bản sau 0007) được chèn/so sánh 'school_year' hoặc 'promotion' của audit_entity; chỉ code ứng dụng dùng chúng sau khi migrate xong.
ALTER TYPE "public"."audit_entity" ADD VALUE 'school_year';--> statement-breakpoint
ALTER TYPE "public"."audit_entity" ADD VALUE 'promotion';--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"from_class_id" uuid NOT NULL,
	"to_class_id" uuid NOT NULL,
	"student_ids" uuid[] NOT NULL,
	"removed_seats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_token" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	CONSTRAINT "promotions_distinct_classes" CHECK ("promotions"."from_class_id" <> "promotions"."to_class_id")
);
--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "next_grade_id" uuid;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_from_class_id_classes_id_fk" FOREIGN KEY ("from_class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_to_class_id_classes_id_fk" FOREIGN KEY ("to_class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_actor_client_token_uq" ON "promotions" USING btree ("actor_id","client_token");--> statement-breakpoint
CREATE INDEX "promotions_from_class_created_idx" ON "promotions" USING btree ("from_class_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_next_grade_id_grades_id_fk" FOREIGN KEY ("next_grade_id") REFERENCES "public"."grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_next_grade_not_self" CHECK ("grades"."next_grade_id" is null or "grades"."next_grade_id" <> "grades"."id");