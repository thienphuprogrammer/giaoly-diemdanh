/** Cài đặt rung/tiếng bíp khi quét: lưu trong localStorage của máy, mặc định bật. */
export const FEEDBACK_STORAGE_KEY = "diemdanh.scan-feedback";
export const FEEDBACK_ON = "on";
export const FEEDBACK_OFF = "off";

export const parseFeedbackSetting = (raw: string | null): boolean => raw !== FEEDBACK_OFF;
export const serializeFeedbackSetting = (on: boolean): string => (on ? FEEDBACK_ON : FEEDBACK_OFF);
