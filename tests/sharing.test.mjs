import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const dist = new URL('../site/.vitepress/dist/', import.meta.url)
const siteUrl = 'https://mjbae.github.io/bae-memoir/'
const title = '아버지의 기록'
const description = '연대별로 엮은 배병희의 자서전입니다.'
const imageUrl = `${siteUrl}og-image.png`
const manuscript = await readFile(new URL('../배병희_자서전.md', import.meta.url), 'utf8')
const chapterTitles = [...manuscript.matchAll(/^## ((\d{4})년대[^\n]*)$/gm)].map((match) => ({
  title: match[1],
  year: match[2],
}))

function decodeHtml(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) => {
    if (entity.startsWith('#')) {
      return String.fromCodePoint(
        entity[1].toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10)
      )
    }
    return named[entity.toLowerCase()]
  })
}

// Parse the built <head> directly: link-preview crawlers must not need JavaScript.
async function staticHead(path) {
  const html = await readFile(new URL(path, dist), 'utf8')
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]
  assert.ok(head, `${path} must have a static head`)
  const tags = (tag) =>
    [...head.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map(([markup]) =>
      Object.fromEntries(
        [...markup.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(
          ([, name, doubleQuoted, singleQuoted]) => [
            name.toLowerCase(),
            decodeHtml(doubleQuoted ?? singleQuoted),
          ]
        )
      )
    )
  const metas = tags('meta')
  const links = tags('link')
  return {
    title: decodeHtml(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
    meta(name) {
      const matches = metas.filter((meta) => meta.property === name || meta.name === name)
      assert.equal(matches.length, 1, `${path} must have one static ${name} meta tag`)
      assert.ok(matches[0].content, `${path} ${name} must not be empty`)
      return matches[0].content
    },
    link(rel, href) {
      const matches = links.filter(
        (link) => link.rel === rel && (href === undefined || link.href === href)
      )
      assert.equal(matches.length, 1, `${path} must have one ${rel} link to ${href ?? 'its URL'}`)
      return matches[0]
    },
  }
}

function assertPreviewImage(head) {
  assert.equal(head.meta('og:image'), imageUrl)
  assert.equal(head.meta('og:image:width'), '1200')
  assert.equal(head.meta('og:image:height'), '630')
  assert.equal(head.meta('og:image:type'), 'image/png')
  assert.ok(head.meta('og:image:alt').trim())
  assert.equal(head.meta('twitter:card'), 'summary_large_image')
  assert.equal(head.meta('twitter:image'), imageUrl)
}

test('the home page provides its sharing title and description without JavaScript', async () => {
  const head = await staticHead('index.html')
  assert.equal(head.title, title)
  assert.equal(head.meta('description'), description)
  assert.equal(head.meta('og:title'), title)
  assert.equal(head.meta('og:description'), description)
  assert.equal(head.meta('twitter:title'), title)
  assert.equal(head.meta('twitter:description'), description)
  assert.equal(head.link('canonical').href, siteUrl)
  assert.equal(head.meta('og:url'), siteUrl)
  assertPreviewImage(head)
})

test('each decade link uses its current manuscript title and stable canonical URL', async () => {
  for (const chapter of chapterTitles) {
    const head = await staticHead(`read/${chapter.year}s.html`)
    const decadeTitle = head.meta('og:title')
    assert.ok(decadeTitle.includes(chapter.title))
    assert.ok(decadeTitle.includes(title))
    assert.ok(head.meta('og:description').includes(description))
    assert.equal(head.meta('twitter:title'), decadeTitle)
    assert.equal(head.meta('twitter:description'), head.meta('og:description'))
    assert.equal(head.link('canonical').href, `${siteUrl}read/${chapter.year}s.html`)
    assert.equal(head.meta('og:url'), `${siteUrl}read/${chapter.year}s.html`)
    assertPreviewImage(head)
  }
})

test('home and decade pages expose browser and mobile icons from the deployed base path', async () => {
  for (const page of ['index.html', `read/${chapterTitles[0].year}s.html`]) {
    const head = await staticHead(page)
    assert.equal(head.link('icon', '/bae-memoir/favicon.svg').type, 'image/svg+xml')
    const favicon = head.link('icon', '/bae-memoir/favicon-32.png')
    assert.equal(favicon.type, 'image/png')
    assert.equal(favicon.sizes, '32x32')
    head.link('apple-touch-icon', '/bae-memoir/apple-touch-icon.png')
    head.link('manifest', '/bae-memoir/site.webmanifest')
  }
})

async function assertPngDimensions(path, width, height) {
  const png = await readFile(new URL(path, dist))
  assert.ok(png.length >= 33, `${path} must contain a PNG header`)
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  assert.equal(png.readUInt32BE(16), width, `${path} width`)
  assert.equal(png.readUInt32BE(20), height, `${path} height`)
}

test('published image files and the mobile manifest use their declared sizes and relative paths', async () => {
  await assertPngDimensions('favicon-32.png', 32, 32)
  await assertPngDimensions('apple-touch-icon.png', 180, 180)
  await assertPngDimensions('og-image.png', 1200, 630)
  const svg = await readFile(new URL('favicon.svg', dist), 'utf8')
  assert.match(svg, /<svg\b/)

  const manifest = JSON.parse(await readFile(new URL('site.webmanifest', dist), 'utf8'))
  assert.equal(manifest.name, title)
  assert.equal(manifest.start_url, './')
  assert.equal(manifest.scope, './')
  assert.ok(Array.isArray(manifest.icons))
  for (const size of [192, 512]) {
    const matchingIcons = manifest.icons.filter((icon) => icon.sizes === `${size}x${size}`)
    assert.equal(matchingIcons.length, 1, `manifest must include one ${size}px icon`)
    const icon = matchingIcons[0]
    assert.equal(icon.type, 'image/png')
    assert.equal(typeof icon.src, 'string')
    assert.ok(icon.src.length > 0)
    assert.doesNotMatch(icon.src, /^(?:\/|[a-z][a-z\d+.-]*:)/i, 'icon URL must be relative')
    assert.ok(new URL(icon.src, siteUrl).href.startsWith(siteUrl))
    await assertPngDimensions(icon.src, size, size)
  }
})
