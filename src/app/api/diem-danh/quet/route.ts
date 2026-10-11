import { db } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/dal";
import { scanLimiter } from "@/server/http/limiter";
import { handleScanApi } from "@/server/http/scan-api";

export const POST = (request: Request) => handleScanApi("scan", request, { db, getUser: getCurrentUser, limiter: scanLimiter });
