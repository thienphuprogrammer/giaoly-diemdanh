import type { ScanMode } from "./scan-rules";

/** Chế độ quét chỉ nhớ trong buổi (sessionStorage, theo sessionId): tuần sau mở lại luôn là "Có mặt". */
export const scanModeKey = (sessionId: string): string => `diemdanh.scanMode:${sessionId}`;

export const parseScanMode = (raw: string | null): ScanMode => (raw === "late" ? "late" : "present");
