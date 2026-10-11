import { db } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/dal";
import { rosterLimiter, scanLimiter } from "@/server/http/limiter";
import { handleScanApi } from "@/server/http/scan-api";

export const GET = (request: Request) => handleScanApi("roster", request, { db, getUser: getCurrentUser, limiter: scanLimiter, rosterLimiter });
