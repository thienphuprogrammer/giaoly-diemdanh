CREATE TYPE "public"."session_kind" AS ENUM('class', 'mass');--> statement-breakpoint
DROP INDEX "sessions_class_date_uq";--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "mass_threshold" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "kind" "session_kind" DEFAULT 'class' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_class_date_kind_uq" ON "sessions" USING btree ("class_id","held_on","kind");