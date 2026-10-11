CREATE TYPE "public"."scan_kind" AS ENUM('scan', 'manual', 'undo');--> statement-breakpoint
CREATE TYPE "public"."scan_result" AS ENUM('applied', 'noop');--> statement-breakpoint
CREATE TABLE "attendance_scans" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"kind" "scan_kind" NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid,
	"actor_id" uuid,
	"mode" text,
	"payload_hash" text NOT NULL,
	"prev_status" "attendance_status",
	"prev_reason" text,
	"new_status" "attendance_status",
	"result" "scan_result" NOT NULL,
	"error_code" text,
	"target_event_id" uuid,
	"captured_at" timestamp,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "last_event_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "qr_token" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_scans" ADD CONSTRAINT "attendance_scans_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_scans" ADD CONSTRAINT "attendance_scans_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_scans" ADD CONSTRAINT "attendance_scans_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_scans_session_idx" ON "attendance_scans" USING btree ("session_id","received_at");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_qr_token_unique" UNIQUE("qr_token");