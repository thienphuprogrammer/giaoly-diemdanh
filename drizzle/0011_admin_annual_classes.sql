-- Chặn ghi song song trong lúc xác định niên khóa và lưu danh sách lớp cũ.
-- Drizzle chạy migration trong transaction; lỗi ở bước kiểm tra phải giữ nguyên toàn bộ dữ liệu.
LOCK TABLE "classes", "sessions", "terms", "students" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE
  mixed_class record;
BEGIN
  SELECT c.id, c.name, count(DISTINCT t.school_year_id) AS year_count
  INTO mixed_class
  FROM public.classes c
  JOIN public.sessions s ON s.class_id = c.id
  JOIN public.terms t ON t.id = s.term_id
  GROUP BY c.id, c.name
  HAVING count(DISTINCT t.school_year_id) > 1
  ORDER BY c.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Lớp "%" (%) có buổi học thuộc nhiều niên khóa (% năm). Migration đã dừng, chưa thay đổi dữ liệu.',
      mixed_class.name, mixed_class.id, mixed_class.year_count
      USING HINT = 'Tách hoặc kiểm tra dữ liệu lớp theo niên khóa trước khi chạy lại migration 0011_admin_annual_classes.';
  END IF;
END $$;
--> statement-breakpoint
-- Chỉ tạo nhãn cho dữ liệu cũ khi thật sự có lớp chưa từng có niên khóa.
INSERT INTO "school_years" ("name")
SELECT 'Dữ liệu cũ'
WHERE EXISTS (SELECT 1 FROM "classes")
  AND NOT EXISTS (SELECT 1 FROM "school_years");
--> statement-breakpoint
-- Mặc định cho lệnh INSERT cũ: ưu tiên năm đang học, rồi năm đã bắt đầu gần nhất,
-- năm tương lai gần nhất, cuối cùng là năm chưa có học kỳ. Giao diện vẫn yêu cầu chọn niên khóa.
CREATE FUNCTION "public"."default_school_year_id"() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT y.id
  FROM public.school_years y
  LEFT JOIN LATERAL (
    SELECT min(t.starts_on) AS first_day,
      bool_or(CURRENT_DATE BETWEEN t.starts_on AND t.ends_on) AS is_current
    FROM public.terms t
    WHERE t.school_year_id = y.id
  ) calendar ON true
  ORDER BY coalesce(calendar.is_current, false) DESC,
    CASE
      WHEN calendar.first_day <= CURRENT_DATE THEN 0
      WHEN calendar.first_day > CURRENT_DATE THEN 1
      ELSE 2
    END,
    CASE WHEN calendar.first_day <= CURRENT_DATE THEN calendar.first_day END DESC,
    CASE WHEN calendar.first_day > CURRENT_DATE THEN calendar.first_day END ASC,
    y.name DESC, y.id
  LIMIT 1;
$$;
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "school_year_id" uuid;
--> statement-breakpoint
-- Kiểm tra trên đã bảo đảm mỗi lớp chỉ có một niên khóa từ các buổi học.
-- Giữ ID lớp, mọi điểm danh, giáo lý viên và chỗ ngồi; không tự gộp hay xóa dữ liệu.
UPDATE "classes" c
SET "school_year_id" = coalesce(
  (SELECT t.school_year_id FROM public.sessions s JOIN public.terms t ON t.id = s.term_id WHERE s.class_id = c.id LIMIT 1),
  public.default_school_year_id()
);
--> statement-breakpoint
ALTER TABLE "classes" ALTER COLUMN "school_year_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "classes" ALTER COLUMN "school_year_id" SET DEFAULT public.default_school_year_id();
--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_year_id_school_years_id_fk" FOREIGN KEY ("school_year_id") REFERENCES "public"."school_years"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "classes_grade_name_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "classes_grade_year_name_uq" ON "classes" USING btree ("grade_id", "school_year_id", "name");
--> statement-breakpoint
CREATE INDEX "classes_school_year_idx" ON "classes" USING btree ("school_year_id");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Bộ đếm chính xác để phiên đã bị thu hồi không hợp lệ trở lại khi thay đổi cùng một giây.
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_session_version_nonnegative" CHECK ("session_version" >= 0);
--> statement-breakpoint
CREATE TABLE "class_memberships" (
  "class_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  CONSTRAINT "class_memberships_class_id_student_id_pk" PRIMARY KEY("class_id", "student_id"),
  CONSTRAINT "class_memberships_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "class_memberships_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "class_memberships_student_idx" ON "class_memberships" USING btree ("student_id");
--> statement-breakpoint
INSERT INTO "class_memberships" ("class_id", "student_id")
SELECT "class_id", "id" FROM "students"
UNION
SELECT s.class_id, a.student_id FROM public.attendance a JOIN public.sessions s ON s.id = a.session_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION "public"."remember_student_class_membership"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.class_memberships (class_id, student_id)
    VALUES (OLD.class_id, NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.class_memberships (class_id, student_id)
  VALUES (NEW.class_id, NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "students_remember_class_membership"
AFTER INSERT OR UPDATE OF "class_id" ON "students"
FOR EACH ROW EXECUTE FUNCTION public.remember_student_class_membership();
--> statement-breakpoint
-- NULL phân biệt lượt lên lớp cũ với lượt mới thật sự không thêm thành viên nào.
ALTER TABLE "promotions" ADD COLUMN "new_membership_student_ids" uuid[];
--> statement-breakpoint
-- So sánh entity::text: tránh dùng giá trị enum vừa thêm trong cùng transaction.
ALTER TYPE "public"."audit_entity" ADD VALUE 'account';
--> statement-breakpoint
ALTER TYPE "public"."audit_entity" ADD VALUE 'grade';
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_scope";
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_scope"
CHECK ("audit_events"."class_id" IS NOT NULL OR "audit_events"."grade_id" IS NOT NULL OR "audit_events"."entity"::text IN ('account', 'grade', 'school_year'));
