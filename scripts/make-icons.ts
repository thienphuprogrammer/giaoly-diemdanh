import { chromium } from "@playwright/test";

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

const OUTPUTS: { path: string; size: number; svg: string }[] = [
  { path: "public/icon-192.png", size: 192, svg: ANY },
  { path: "public/icon-512.png", size: 512, svg: ANY },
  { path: "public/icon-maskable-512.png", size: 512, svg: MASKABLE },
];

async function main() {
  const browser = await chromium.launch();
  try {
    for (const out of OUTPUTS) {
      const page = await browser.newPage({ viewport: { width: out.size, height: out.size } });
      try {
        await page.setContent(`<body style="margin:0">${out.svg}</body>`);
        await page.screenshot({ path: out.path, clip: { x: 0, y: 0, width: out.size, height: out.size } });
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
