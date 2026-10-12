import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { APP_COLORS, IOS_SPLASH } from "../src/app/pwa-meta";

const BG = `<rect width="512" height="512" fill="#1d4ed8"/>`;
const ART = `
  <rect x="96" y="156" width="140" height="90" rx="22" fill="#ffffff"/>
  <rect x="276" y="156" width="140" height="90" rx="22" fill="#ffffff"/>
  <rect x="96" y="286" width="140" height="90" rx="22" fill="#ffffff" opacity=".55"/>
  <path d="M296 331l34 34 70-76" fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>`;
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">${BG}${body}</svg>`;

// Maskable: thu nhỏ nghệ thuật 0.7 quanh tâm. Góc xa nhất (96,376) cách tâm 200px => 140px sau khi thu, nằm trong vùng an toàn bán kính 0.4*512 = 204.8px.
const MASKABLE_SCALE = 0.7;
const ANY = svg(ART);
const MASKABLE = svg(`<g transform="translate(256 256) scale(${MASKABLE_SCALE}) translate(-256 -256)">${ART}</g>`);

/** Kích thước theo CSS px; `scale` = tỉ lệ điểm ảnh (ảnh ra = width*scale x height*scale). */
interface Output { path: string; width: number; height: number; scale: number; html: string }
const square = (file: string, size: number, art: string): Output =>
  ({ path: file, width: size, height: size, scale: 1, html: `<body style="margin:0">${art}</body>` });

// Ảnh khởi động iOS: nền trang, icon bo góc 120 CSS px ở giữa (không chữ, tránh lệ thuộc font của máy sinh ảnh).
const SPLASH_ICON = 120;
const splash = (s: (typeof IOS_SPLASH)[number]): Output => ({
  path: `public${s.url}`, width: s.cssWidth, height: s.cssHeight, scale: s.ratio,
  html: `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:${APP_COLORS.background}">
    <div style="width:${SPLASH_ICON}px;height:${SPLASH_ICON}px;border-radius:${SPLASH_ICON * 0.225}px;overflow:hidden">${ANY}</div></body>`,
});

const OUTPUTS: Output[] = [
  square("public/icon-192.png", 192, ANY),
  square("public/icon-512.png", 512, ANY),
  square("public/icon-maskable-512.png", 512, MASKABLE),
  // iOS tự bo góc và không nhận nền trong suốt: ảnh vuông kín nền.
  square("public/apple-touch-icon.png", 180, ANY),
  ...IOS_SPLASH.map(splash),
];

async function main() {
  const browser = await chromium.launch();
  try {
    for (const out of OUTPUTS) {
      mkdirSync(path.dirname(out.path), { recursive: true });
      const page = await browser.newPage({ viewport: { width: out.width, height: out.height }, deviceScaleFactor: out.scale });
      try {
        await page.setContent(out.html);
        await page.screenshot({ path: out.path, clip: { x: 0, y: 0, width: out.width, height: out.height } });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
