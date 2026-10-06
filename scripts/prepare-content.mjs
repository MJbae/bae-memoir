import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import matter from 'gray-matter'
import { parseDecadeHeading } from '../site/.vitepress/shared/decade-heading.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainFilename = '배병희_자서전.md'
const excludedRootFiles =
  /^(?:readme(?:[._-].*)?|agents|setup(?:[._-].*)?|deployment|deploy|contributing|changelog|license|security|code_of_conduct|운영안내|설치안내)\.md$/i
// Exact editorial filenames only: other family manuscripts may contain “제안서”.
const excludedEditorialFiles = new Set([
  '윤문제안서.md',
  '윤문제안서_최종.md',
  '사랑을_주제로_한_일대기_구성_개선_제안서.md',
])
const isExcludedMarkdown = (filename) =>
  excludedRootFiles.test(filename) ||
  excludedEditorialFiles.has(filename.normalize('NFC').toLowerCase())
const validId = /^[a-z0-9][a-z0-9_-]{0,79}$/
const assetExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.pdf',
  '.txt',
  '.mp3',
  '.mp4',
  '.m4a',
  '.ogg',
  '.wav',
])

const slash = (value) => value.split(path.sep).join('/')
const digest = (value) => createHash('sha256').update(value).digest('hex')
const isInside = (root, candidate) => {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Catalog text is plain text, never a fragment of source HTML or Markdown. */
export function plainText(markdown) {
  return String(markdown)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|#39);/g,
      (entity) =>
        ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[
          entity
        ]
    )
    .replace(/\s+/g, ' ')
    .trim()
}

const summary = (markdown, limit = 130) => {
  const text = plainText(markdown)
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}

const readingMinutes = (markdown) => Math.max(1, Math.ceil(plainText(markdown).length / 500))

function outsideFences(markdown, transform) {
  let fence = null
  return markdown
    .split(/(?<=\n)/)
    .map((line) => {
      const match = line.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (match) {
        if (!fence) fence = match[1]
        else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null
        return line
      }
      return fence ? line : transform(line)
    })
    .join('')
}

function headings(markdown) {
  const result = []
  let offset = 0
  let fence = null
  for (const line of markdown.split(/(?<=\n)/)) {
    const delimiter = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (delimiter) {
      if (!fence) fence = delimiter[1]
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null
    } else if (!fence) {
      const match = line.match(/^(#{1,2}) ([^\r\n]+)\r?\n?$/)
      if (match && (match[1] === '##' || /^(?:프롤로그|에필로그)(?=$|[\s:：—–-])/u.test(match[2])))
        result.push({ title: match[2].trim(), start: offset, bodyStart: offset + line.length })
    }
    offset += line.length
  }
  return result
}

function discover(root) {
  const sources = readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith('.') &&
        /\.md$/i.test(entry.name) &&
        !isExcludedMarkdown(entry.name)
    )
    .map((entry) => entry.name)
  const contentRoot = path.join(root, 'content')
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink())
        continue
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(filename)
      else if (entry.isFile() && /\.md$/i.test(entry.name) && !isExcludedMarkdown(entry.name))
        sources.push(slash(path.relative(root, filename)))
    }
  }
  if (existsSync(contentRoot) && !lstatSync(contentRoot).isSymbolicLink()) visit(contentRoot)
  return sources.sort((a, b) => a.localeCompare(b, 'ko'))
}

function frontmatter(metadata, content) {
  // JSON values are valid YAML, including Korean text and nested prev/next objects.
  return `---\n${Object.entries(metadata)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n')}\n---\n\n${content}`
}

function firstParagraph(markdown) {
  return (
    markdown
      .replace(/^# [^\r\n]+\r?\n/, '')
      .trim()
      .split(/\r?\n\s*\r?\n/)
      .find((paragraph) => !/^#{1,6} /.test(paragraph)) ?? ''
  )
}

export function prepareContent({ root = projectRoot, logger = console } = {}) {
  root = path.resolve(root)
  const outputDir = path.join(root, 'site/read')
  const generatedDir = path.join(root, 'site/.vitepress/generated')
  const manifestFile = path.join(generatedDir, 'content-manifest.json')
  const warnings = []
  const warn = (message) => {
    warnings.push(message)
    logger.warn?.(`[content] ${message}`)
  }
  const sources = discover(root)
  if (!sources.includes(mainFilename)) throw new Error(`필수 원본이 없습니다: ${mainFilename}`)

  const loaded = sources
    .map((source) => {
      const parsed = matter(readFileSync(path.join(root, source), 'utf8'))
      return { source, body: parsed.content, data: parsed.data }
    })
    .filter(({ source, data }) => {
      if (data.published === false || data.draft === true) {
        if (source === mainFilename)
          throw new Error('연대별 원본은 published: false 또는 draft: true로 숨길 수 없습니다.')
        return false
      }
      return true
    })

  const main = loaded.find(({ source }) => source === mainFilename)
  const sections = headings(main.body)
  const chapterSections = sections.filter(({ title }) => /^\d{4}년대(?=$|[\s:：—–-])/u.test(title))
  if (!chapterSections.length) {
    throw new Error('연대 제목이 없습니다. 원본에 ## 1930년대 — 제목 같은 2단계 제목을 넣으세요.')
  }
  const foundDecades = new Set()
  for (const section of chapterSections) {
    const heading = parseDecadeHeading(section.title)
    if (!heading)
      throw new Error(`연대 제목의 연도는 네 자리의 10년 단위여야 합니다: ${section.title}`)
    if (foundDecades.has(heading.year))
      throw new Error(`연대 제목 중복: ${heading.label}. 각 연대는 한 번만 지정하세요.`)
    foundDecades.add(heading.year)
  }

  const usedIds = new Map()
  const usedFiles = new Map()
  const pages = []
  const sourceUrls = new Map()
  const register = (page) => {
    if (!validId.test(page.id))
      throw new Error(
        `안전하지 않은 문서 id: ${page.id}. 영문 소문자·숫자·하이픈·밑줄로 1~80자 이내로 정하세요.`
      )
    if (usedIds.has(page.id))
      throw new Error(`문서 id 중복: ${page.id} (${usedIds.get(page.id)}, ${page.source})`)
    if (usedFiles.has(page.filename))
      throw new Error(
        `생성 경로 중복: ${page.filename} (${usedFiles.get(page.filename)}, ${page.source})`
      )
    usedIds.set(page.id, page.source)
    usedFiles.set(page.filename, page.source)
    pages.push(page)
    return page
  }

  const chapters = chapterSections.map((section) => {
    const { year: decade, label, subtitle } = parseDecadeHeading(section.title)
    const nextSection = sections[sections.indexOf(section) + 1]
    const body = `# ${section.title}\n${main.body.slice(section.bodyStart, nextSection?.start ?? main.body.length)}`
    const description = summary(
      firstParagraph(main.body.slice(section.bodyStart, nextSection?.start ?? main.body.length))
    )
    const chapter = {
      id: `life-${decade}s`,
      title: section.title,
      subtitle,
      description,
      url: `/read/${decade}s.html`,
      decade: label,
      minutes: readingMinutes(body),
    }
    register({ ...chapter, filename: `${decade}s.md`, body, kind: 'chapter', source: mainFilename })
    return chapter
  })

  const bookends = sections
    .filter(({ title }) => /^(?:프롤로그|에필로그)(?=$|[\s:：—–-])/u.test(title))
    .map((section) => {
      const label = section.title.startsWith('프롤로그') ? '프롤로그' : '에필로그'
      const slug = label === '프롤로그' ? 'prologue' : 'epilogue'
      const nextSection = sections[sections.indexOf(section) + 1]
      const content = main.body.slice(section.bodyStart, nextSection?.start ?? main.body.length)
      const body = `# ${section.title}\n${content}`
      const chapter = {
        id: `life-${slug}`,
        title: section.title,
        subtitle: section.title.slice(label.length).replace(/^[\s:：—–-]+/u, ''),
        description: summary(firstParagraph(content)),
        url: `/read/${slug}.html`,
        decade: label,
        minutes: readingMinutes(body),
      }
      register({ ...chapter, filename: `${slug}.md`, body, kind: 'chapter', source: mainFilename })
      return chapter
    })
  const readingOrder = [...chapters, ...bookends].sort(
    (a, b) =>
      sections.findIndex(({ title }) => title === a.title) -
      sections.findIndex(({ title }) => title === b.title)
  )

  const fullStory = {
    id: 'life-story',
    title: '자서전 전체 보기',
    url: '/read/life-story.html',
    minutes: readingMinutes(main.body),
  }
  register({
    ...fullStory,
    filename: 'life-story.md',
    body: main.body,
    kind: 'full',
    source: mainFilename,
    description: summary(firstParagraph(main.body)),
    decade: '',
  })
  sourceUrls.set(mainFilename, fullStory.url)

  const documents = loaded
    .filter(({ source }) => source !== mainFilename)
    .map(({ source, body, data }) => {
      if (data.id !== undefined && typeof data.id !== 'string')
        throw new Error(`문서 id는 문자열이어야 합니다: ${source}`)
      const id = data.id ?? `doc-${digest(source).slice(0, 12)}`
      const firstHeading = body.match(/^# (.+)$/m)?.[1]
      const title = plainText(
        data.title ?? firstHeading ?? path.basename(source, path.extname(source))
      )
      if (!title) throw new Error(`문서 제목이 비어 있습니다: ${source}`)
      const document = {
        id,
        title,
        description: summary(data.description ?? firstParagraph(body)),
        url: `/read/${id}.html`,
        minutes: readingMinutes(body),
        category: plainText(data.category ?? '가족 자료'),
      }
      if (data.date !== undefined)
        document.date =
          data.date instanceof Date ? data.date.toISOString().slice(0, 10) : plainText(data.date)
      register({ ...document, filename: `${id}.md`, body, kind: 'document', source, decade: '' })
      sourceUrls.set(source, document.url)
      return document
    })

  const assets = new Map()
  function resolveDestination(destination, source) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(destination)) return destination
    const parts = destination.match(/^([^?#]*)([?#].*)?$/)
    if (!parts?.[1]) return destination
    let localPath
    try {
      localPath = decodeURIComponent(parts[1])
    } catch {
      warn(`링크 경로를 해석하지 못했습니다: ${source} → ${destination}`)
      return destination
    }
    const target = localPath.startsWith('/')
      ? path.resolve(root, `.${localPath}`)
      : path.resolve(root, path.dirname(source), localPath)
    if (!isInside(root, target)) {
      warn(`저장소 밖의 파일 링크는 복사하지 않습니다: ${source} → ${destination}`)
      return destination
    }
    const relative = slash(path.relative(root, target))
    const suffix = parts[2] ?? ''
    if (sourceUrls.has(relative)) return sourceUrls.get(relative) + suffix
    if (/\.md$/i.test(relative)) {
      warn(`공개 자료에서 찾을 수 없는 Markdown 링크: ${source} → ${destination}`)
      return destination
    }
    if (!assetExtensions.has(path.extname(target).toLowerCase())) return destination
    if (!existsSync(target)) {
      warn(`첨부파일이 없습니다: ${source} → ${destination}`)
      return destination
    }
    if (!isInside(realpathSync(root), realpathSync(target)) || !lstatSync(target).isFile()) {
      warn(`일반 저장소 파일이 아닌 첨부파일은 복사하지 않습니다: ${source} → ${destination}`)
      return destination
    }
    const assetName = `assets/${digest(relative).slice(0, 16)}${path.extname(target).toLowerCase()}`
    assets.set(assetName, target)
    return `./${assetName}${suffix}`
  }

  function rewriteLinks(body, source) {
    return outsideFences(body, (line) =>
      line
        .replace(
          /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^\s)]+)([^)\n]*\))/g,
          (_, prefix, destination, rest) => {
            const bracketed = destination.startsWith('<')
            const resolved = resolveDestination(
              bracketed ? destination.slice(1, -1) : destination,
              source
            )
            return `${prefix}${bracketed ? `<${resolved}>` : resolved}${rest}`
          }
        )
        .replace(
          /^(\s{0,3}\[[^\]\n]+\]:\s*)(<[^>\n]+>|\S+)([\s\S]*)$/,
          (_, prefix, destination, rest) => {
            const bracketed = destination.startsWith('<')
            const resolved = resolveDestination(
              bracketed ? destination.slice(1, -1) : destination,
              source
            )
            return `${prefix}${bracketed ? `<${resolved}>` : resolved}${rest}`
          }
        )
    )
  }

  const outputs = new Map(
    pages.map((page) => {
      const index = readingOrder.findIndex(({ id }) => id === page.id)
      const neighbor = (chapter) =>
        chapter ? { title: chapter.title, decade: chapter.decade, url: chapter.url } : null
      const metadata = {
        title: page.title,
        description: page.description,
        commentId: page.id,
        kind: page.kind,
        decade: page.decade,
        minutes: page.minutes,
        prev: page.kind === 'chapter' ? neighbor(readingOrder[index - 1]) : null,
        next: page.kind === 'chapter' ? neighbor(readingOrder[index + 1]) : null,
        outline: [2, 3],
      }
      if (page.date !== undefined) metadata.date = page.date
      return [page.filename, frontmatter(metadata, rewriteLinks(page.body, page.source))]
    })
  )
  const catalog = {
    title: '아버지의 기록',
    introduction: plainText(main.body.slice(0, sections[0].start).replace(/^# [^\r\n]+\r?\n/, '')),
    chapters,
    readingOrder,
    documents,
    fullStory,
  }

  let previousFiles = []
  if (existsSync(manifestFile)) {
    const previous = JSON.parse(readFileSync(manifestFile, 'utf8'))
    previousFiles = Array.isArray(previous.files) ? previous.files : []
    for (const filename of previousFiles) {
      if (
        typeof filename !== 'string' ||
        !/^(?:[a-z0-9][a-z0-9_-]*\.md|assets\/[a-f0-9]+\.[a-z0-9]+)$/.test(filename)
      ) {
        throw new Error(
          '이전 생성 목록에 안전하지 않은 경로가 있습니다. content-manifest.json을 확인하세요.'
        )
      }
    }
  }
  const generatedFiles = [...outputs.keys(), ...assets.keys()]
  for (const filename of generatedFiles) {
    if (existsSync(path.join(outputDir, filename)) && !previousFiles.includes(filename)) {
      throw new Error(
        `직접 작성한 파일을 덮어쓰지 않습니다: site/read/${filename}. 원본은 루트 또는 content/에 두세요.`
      )
    }
  }
  mkdirSync(outputDir, { recursive: true })
  mkdirSync(generatedDir, { recursive: true })
  for (const [filename, content] of outputs) writeFileSync(path.join(outputDir, filename), content)
  for (const [filename, source] of assets) {
    mkdirSync(path.dirname(path.join(outputDir, filename)), { recursive: true })
    copyFileSync(source, path.join(outputDir, filename))
  }
  for (const stale of previousFiles.filter((filename) => !generatedFiles.includes(filename)))
    rmSync(path.join(outputDir, stale), { force: true })
  const manifest = {
    version: 1,
    files: generatedFiles,
    sources: pages.map(({ source, id, filename }) => ({ source, id, filename })),
  }
  for (const [filename, value] of [
    ['catalog.json', catalog],
    ['content-manifest.json', manifest],
  ]) {
    const target = path.join(generatedDir, filename)
    writeFileSync(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
    renameSync(`${target}.tmp`, target)
  }
  logger.log?.(
    `[content] ${chapters.length}개 연대 · ${documents.length}개 자료 · 전체글 준비 완료`
  )
  return { catalog, manifest, warnings }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    prepareContent()
  } catch (error) {
    console.error(`[content] ${error.message}`)
    process.exitCode = 1
  }
}
