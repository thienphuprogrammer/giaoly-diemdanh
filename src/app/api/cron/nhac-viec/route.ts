import { db } from "@/db/client";
import { handleCronRequest } from "@/server/http/cron";
import { pushDeliver, runReminders } from "@/server/services/reminders";

/**
 * Tác vụ nhắc việc định kỳ (spec §4). Không có phiên người dùng: chỉ xác thực bằng `Authorization: Bearer <CRON_SECRET>`
 * trong `handleCronRequest` (so sánh hằng thời gian; bí mật thiếu/ngắn hơn 32 ký tự => 503, không bao giờ chạy).
 * GET vì Vercel Cron gọi GET; POST cho bộ gọi ngoài (GitHub Actions, cron-job.org). Cách kích hoạt:
 * docs/deploy-vercel-ios.md, mục "Nhắc việc tự động". Danh sách miễn của auth-guard: `tệp::handleCronRequest`.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handle = (request: Request) =>
  handleCronRequest(request, {
    env: process.env,
    run: (now) => runReminders(db, { now, deliver: pushDeliver(db, process.env) }),
  });

export const GET = handle;
export const POST = handle;
