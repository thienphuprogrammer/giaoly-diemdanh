import webpush from "web-push";

/**
 * Sinh một cặp khoá VAPID mới cho thông báo đẩy và IN RA MÀN HÌNH (không ghi tệp). Chép vào biến môi trường của
 * Vercel/`.env.local`; KHÔNG commit. Đổi khoá thì mọi thiết bị phải bật lại thông báo (trang Tài khoản tự đăng ký lại
 * khi mở nếu quyền đã cấp).
 */
const keys = webpush.generateVAPIDKeys();
console.error([
  "CẢNH BÁO: VAPID_PRIVATE_KEY là bí mật. Chỉ đặt trong biến môi trường (Vercel → Settings → Environment Variables",
  "hoặc .env.local), không commit, không gửi qua chat. Thay email ở VAPID_SUBJECT bằng email liên hệ của giáo xứ.",
  "",
].join("\n"));
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:email-lien-he@ten-mien");
