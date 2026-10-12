import { Be_Vietnam_Pro, Lexend } from "next/font/google";
import "./globals.css";
import { appMetadata, appViewport } from "./pwa-meta";

// Lexend: tiêu đề, số, nhãn trạng thái, nút. Be Vietnam Pro: chữ thường và biểu mẫu. Cả hai có bộ dấu tiếng Việt.
const body = Be_Vietnam_Pro({
  variable: "--font-body-face",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500"],
  display: "swap",
});
const display = Lexend({
  variable: "--font-display-face",
  subsets: ["vietnamese", "latin"],
  weight: ["500", "600"],
  display: "swap",
});

export const metadata = appMetadata;
export const viewport = appViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${body.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-dvh font-sans text-ink">{children}</body>
    </html>
  );
}
