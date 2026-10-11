import { chromium } from "@playwright/test";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <rect width="512" height="512" fill="#2f5d46"/>
  <rect x="96" y="156" width="140" height="90" rx="22" fill="#f7f1e6"/>
  <rect x="276" y="156" width="140" height="90" rx="22" fill="#f7f1e6"/>
  <rect x="96" y="286" width="140" height="90" rx="22" fill="#f7f1e6" opacity=".55"/>
  <path d="M296 331l34 34 70-76" fill="none" stroke="#f7f1e6" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

async function main() {
  const browser = await chromium.launch();
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0">${SVG}</body>`);
    await page.screenshot({ path: `public/icon-${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
  await browser.close();
}
main();
