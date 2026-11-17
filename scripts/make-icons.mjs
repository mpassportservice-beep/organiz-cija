// Renders web/public/icon.svg into the PNG icons the manifest needs. Run: node scripts/make-icons.mjs (needs playwright).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = fs.readFileSync(new URL('../web/public/icon.svg', import.meta.url), 'utf8');
const b = await chromium.launch();
const shot = async (file, size, maskable) => {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const inner = maskable ? svg.replace('rx="96"', 'rx="0"') : svg;
  await p.setContent(`<body style="margin:0;background:${maskable ? '#0a0a0a' : 'transparent'};display:grid;place-items:center;height:100vh"><div style="width:${maskable ? 78 : 100}%;line-height:0">${inner}</div></body>`);
  await p.screenshot({ path: new URL(`../web/public/${file}`, import.meta.url).pathname, omitBackground: !maskable });
  await p.close();
};
await shot('icon-192.png', 192, false);
await shot('icon-512.png', 512, false);
await shot('icon-maskable-512.png', 512, true);
await shot('apple-touch-icon.png', 180, true);
await b.close();
