import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import { appMetadata, appViewport } from "./pwa-meta";

// Một họ chữ có đầy đủ dấu tiếng Việt cho cả nội dung, tiêu đề và điều khiển.
const body = Be_Vietnam_Pro({
  variable: "--font-body-face",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata = appMetadata;
export const viewport = appViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${body.variable} h-full antialiased`}>
      <body className="min-h-dvh font-sans text-ink">{children}</body>
    </html>
  );
}
