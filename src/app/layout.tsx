import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Fraunces } from "next/font/google";
import "./globals.css";

const body = Be_Vietnam_Pro({
  variable: "--font-body-face",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700"],
});
const display = Fraunces({
  variable: "--font-display-face",
  subsets: ["vietnamese", "latin"],
});

export const metadata: Metadata = {
  title: "Điểm danh Giáo lý",
  description: "Điểm danh lớp giáo lý theo sơ đồ chỗ ngồi",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#2f5d46",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${body.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
