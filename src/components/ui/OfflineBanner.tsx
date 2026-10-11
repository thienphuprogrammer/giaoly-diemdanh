"use client";
import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** `navigator.onLine` theo sự kiện online/offline; phía server coi như đang có mạng. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/** Dải báo mất mạng; chỉ hiện khi trình duyệt báo offline. */
export function OfflineBanner({ children }: { children: React.ReactNode }) {
  if (useOnline()) return null;
  return (
    <div role="status" className="flex items-start gap-2 rounded-control border border-warn-watch/30 bg-warn-watch-tint px-3 py-2.5 text-sm font-medium text-warn-watch">
      <WifiOff aria-hidden size={18} className="mt-px shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
