CREATE TYPE "public"."audit_entity" AS ENUM('attendance', 'student', 'seating_plan', 'session', 'grade_settings');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"class_id" uuid,
	"grade_id" uuid,
	"entity" "audit_entity" NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_events_scope" CHECK ("audit_events"."class_id" is not null or "audit_events"."grade_id" is not null),
	CONSTRAINT "audit_events_summary_object" CHECK (jsonb_typeof("audit_events"."summary") = 'object')
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_class_at_idx" ON "audit_events" USING btree ("class_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_grade_at_idx" ON "audit_events" USING btree ("grade_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "audit_events" USING btree ("at");