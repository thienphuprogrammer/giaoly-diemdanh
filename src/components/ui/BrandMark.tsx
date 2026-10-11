/** Logo: ba băng ghế + dấu tích (cùng hình học với biểu tượng PWA), màu hành động. */
export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 512 512" className="shrink-0">
      <rect width="512" height="512" rx="120" fill="var(--action)" />
      <rect x="96" y="156" width="140" height="90" rx="22" fill="#fff" />
      <rect x="276" y="156" width="140" height="90" rx="22" fill="#fff" />
      <rect x="96" y="286" width="140" height="90" rx="22" fill="#fff" opacity=".55" />
      <path d="M296 331l34 34 70-76" fill="none" stroke="#fff" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
