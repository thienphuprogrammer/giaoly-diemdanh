-- Cột cho phép NULL, không mặc định: an toàn trên dữ liệu có sẵn (người chưa đổi mật khẩu = phiên cũ vẫn hợp lệ).
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;