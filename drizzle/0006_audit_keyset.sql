DROP INDEX "audit_events_class_at_idx";--> statement-breakpoint
DROP INDEX "audit_events_grade_at_idx";--> statement-breakpoint
CREATE INDEX "audit_events_class_at_idx" ON "audit_events" USING btree ("class_id","at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_grade_at_idx" ON "audit_events" USING btree ("grade_id","at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_action_format" CHECK ("audit_events"."action" ~ '^[a-z_]+\.[a-z_]+$');