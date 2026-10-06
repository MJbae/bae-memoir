import { defineConfig } from 'vitepress'
import { loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import { episodeComments } from './markdown/episode-comments'
import catalog from './generated/catalog.json'

const root = fileURLToPath(new URL('../../', import.meta.url))
const env = loadEnv(process.env.NODE_ENV || 'production', root, '')
const base = process.env.SITE_BASE || env.SITE_BASE || '/bae-memoir/'
const workTitle = catalog.work.title
const siteName = workTitle
const siteDescription = catalog.work.synopsis[0]
const siteOrigin = 'https://mjbae.github.io'
const shareImage = new URL(`${base}og-image.png`, siteOrigin).href
const commentsConfigured = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
].every((key) => env[key]?.trim())

export default defineConfig({
  lang: 'ko-KR',
  title: workTitle,
  titleTemplate: `:title · ${workTitle}`,
  description: siteDescription,
  base,
  lastUpdated: false,
  cleanUrls: false,
  appearance: false,
  head: [
    ['script', {}, "try{const m=localStorage.getItem('family-library:theme');if(['auto','light','dark'].includes(m))document.documentElement.dataset.theme=m}catch(e){}"],
    ['meta', { name: 'theme-color', content: '#ffffff' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    [
      'meta',
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    ],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${base}favicon-32.png` }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: `${base}apple-touch-icon.png` }],
    ['link', { rel: 'manifest', href: `${base}site.webmanifest` }],
    ['meta', { name: 'application-name', content: siteName }],
    ['meta', { name: 'apple-mobile-web-app-title', content: siteName }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'ko_KR' }],
    ['meta', { property: 'og:site_name', content: siteName }],
    ['meta', { property: 'og:image', content: shareImage }],
    ['meta', { property: 'og:image:secure_url', content: shareImage }],
    ['meta', { property: 'og:image:type', content: 'image/png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: `${siteName}. ${siteDescription}` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: shareImage }],
    ['meta', { name: 'twitter:image:alt', content: `${siteName}. ${siteDescription}` }],
  ],
  markdown: {
    headers: { level: [2, 3] },
    // 원고의 일반 Markdown과 사진을 지원하며 임의 HTML 실행은 허용하지 않습니다.
    config(md) {
      md.set({ html: false })
      md.use(episodeComments, { base, enabled: commentsConfigured })
    },
  },
  vite: {
    envDir: root,
    server: { fs: { allow: [root] } },
    build: { chunkSizeWarningLimit: 650 },
  },
  transformPageData(pageData) {
    const isHome = pageData.frontmatter.layout === 'home'
    const title = isHome ? workTitle : String(pageData.frontmatter.shareTitle || `${pageData.title} · ${workTitle}`)
    pageData.frontmatter.titleTemplate = false
    pageData.title = title
    const description = isHome ? siteDescription : String(pageData.frontmatter.description || siteDescription)
    const relative = pageData.relativePath
      .replace(/(^|\/)index\.md$/, '$1')
      .replace(/\.md$/, '.html')
    const url = new URL(`${base}${pageData.frontmatter.redirect ? String(pageData.frontmatter.redirect).replace(/^\//, '') : relative}`, siteOrigin).href
    pageData.description = description
    pageData.frontmatter.description = description
    pageData.frontmatter.head ??= []
    if (pageData.frontmatter.redirect) pageData.frontmatter.head.push(['meta', { 'http-equiv': 'refresh', content: `0;url=${base}${String(pageData.frontmatter.redirect).replace(/^\//, '')}` }])
    pageData.frontmatter.head.push(
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }]
    )
  },
})
