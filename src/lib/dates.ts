const VN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }); // YYYY-MM-DD

export function todayInVietnam(now: Date = new Date()): string {
  return VN_DAY.format(now);
}
