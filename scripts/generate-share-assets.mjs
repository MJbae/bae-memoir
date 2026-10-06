import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// Regenerate with: node scripts/generate-share-assets.mjs
// Uses a local Korean system font; Apple SD Gothic Neo on macOS or Noto Sans KR.
// No external image or font request is made.
const publicDirectory = fileURLToPath(new URL('../site/public/', import.meta.url))
const icon = await readFile(`${publicDirectory}/favicon.svg`, 'utf8')
const browser = await chromium.launch({ headless: true })

try {
  await mkdir(publicDirectory, { recursive: true })
  const page = await browser.newPage({ deviceScaleFactor: 1 })

  for (const [filename, size] of [
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ]) {
    await page.setViewportSize({ width: size, height: size })
    // Apple applies its own corner mask to home-screen icons.
    const source = filename === 'apple-touch-icon.png'
      ? icon.replace('rx="14"', 'rx="0"')
      : icon
    await page.setContent(`<!doctype html><html><head><style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; background: transparent; }
      svg { display: block; width: 100%; height: 100%; }
    </style></head><body>${source}</body></html>`)
    await page.screenshot({ path: `${publicDirectory}/${filename}`, omitBackground: true })
  }

  await page.setViewportSize({ width: 1200, height: 630 })
  await page.setContent(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { width: 1200px; height: 630px; margin: 0; }
    body { background: #f5f5f7; color: #1d1d1f;
      font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif; }
    main { height: 100%; padding: 76px 96px; }
    .icon { width: 54px; height: 54px; margin-bottom: 52px; }
    .icon svg { display: block; width: 100%; height: 100%; }
    h1 { margin: 0 0 26px; font-size: 76px; font-weight: 700; line-height: 1.12; letter-spacing: -3.2px; }
    p { margin: 0; color: #6e6e73; font-size: 35px; font-weight: 400; line-height: 1.5; letter-spacing: -0.8px; }
    footer { margin-top: 48px; color: #86868b; font-size: 22px; font-weight: 500; letter-spacing: 1px; }
  </style></head><body><main>
    <div class="icon">${icon}</div>
    <h1>아버지의 기록</h1>
    <p>연대별로 엮은<br>배병희의 자서전입니다.</p>
    <footer>1930 — 2020</footer>
  </main></body></html>`)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${publicDirectory}/og-image.png` })
  await page.close()

  await writeFile(`${publicDirectory}/site.webmanifest`, JSON.stringify({
    name: '아버지의 기록',
    short_name: '아버지의 기록',
    description: '연대별로 엮은 배병희의 자서전입니다.',
    lang: 'ko',
    id: './',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }, null, 2) + '\n')
} finally {
  await browser.close()
}

console.log('Generated the sharing image, mobile icons, and web manifest.')
