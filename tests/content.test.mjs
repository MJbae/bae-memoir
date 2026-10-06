import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import matter from 'gray-matter'
import { createMarkdownRenderer } from 'vitepress'
import { prepareContent, plainText } from '../scripts/prepare-content.mjs'
import { parseDecadeHeading } from '../site/.vitepress/shared/decade-heading.mjs'
import { decadeComments } from '../site/.vitepress/markdown/decade-comments.ts'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainFilename = '배병희_자서전.md'
const original = readFileSync(path.join(repo, mainFilename), 'utf8')
const sourceHeadings = [...original.matchAll(/^#{1,2} (.+)$/gm)].map((match) => ({
  title: match[1],
  start: match.index,
  bodyStart: match.index + match[0].length + 1,
}))
const sourceChapters = sourceHeadings.filter(({ title }) => /^\d{4}년대/.test(title))
const silent = { log() {}, warn() {} }

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'family-content-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, mainFilename), original)
  const write = (filename, body) => {
    mkdirSync(path.dirname(path.join(root, filename)), { recursive: true })
    writeFileSync(path.join(root, filename), body)
  }
  const run = () => prepareContent({ root, logger: silent })
  const readPage = (filename) =>
    matter(readFileSync(path.join(root, 'site/read', filename), 'utf8'))
  return { root, write, run, readPage }
}

test('원본에 있는 연대와 전체글을 생성하며 제목과 모든 본문을 보존한다', (t) => {
  const { root, run, readPage } = fixture(t)
  const { catalog } = run()
  assert.equal(catalog.title, '아버지의 기록')
  assert.equal(catalog.chapters.length, sourceChapters.length)
  assert.equal(catalog.documents.length, 0)
  assert.deepEqual(
    catalog.chapters.map(({ id }) => id),
    sourceChapters.map(({ title }) => `life-${title.slice(0, 4)}s`)
  )
  assert.deepEqual(
    catalog.chapters.map(({ title }) => title),
    sourceChapters.map(({ title }) => title)
  )
  assert.equal(readFileSync(path.join(root, mainFilename), 'utf8'), original)
  // The generated front matter adds one leading separator newline; the entire source is byte-for-byte present.
  assert.equal(readPage('life-story.md').content.trimStart(), original)
  for (let index = 0; index < catalog.chapters.length; index++) {
    const chapter = catalog.chapters[index]
    const section = sourceChapters[index]
    const decade = section.title.slice(0, 4)
    const page = readPage(`${decade}s.md`)
    const nextSection = sourceHeadings[sourceHeadings.indexOf(section) + 1]
    const expectedBody = original.slice(section.bodyStart, nextSection?.start ?? original.length)
    assert.equal(page.content.trimStart(), `# ${chapter.title}\n${expectedBody}`)
    assert.equal(chapter.url, `/read/${decade}s.html`)
    assert.equal(page.data.commentId, chapter.id)
    assert.equal(page.data.kind, 'chapter')
    const readingIndex = catalog.readingOrder.findIndex(({ id }) => id === chapter.id)
    assert.equal(page.data.prev?.url ?? null, catalog.readingOrder[readingIndex - 1]?.url ?? null)
    assert.equal(page.data.next?.url ?? null, catalog.readingOrder[readingIndex + 1]?.url ?? null)
    assert.equal(
      page.data.prev?.decade ?? null,
      catalog.readingOrder[readingIndex - 1]?.decade ?? null
    )
    assert.equal(
      page.data.next?.decade ?? null,
      catalog.readingOrder[readingIndex + 1]?.decade ?? null
    )
    assert.ok(page.data.minutes >= 1)
  }
})

test('프롤로그와 에필로그를 분리하고 연대 본문과 앞뒤 읽기를 연결한다', (t) => {
  const { write, run, readPage } = fixture(t)
  for (const level of ['#', '##']) {
    write(
      mainFilename,
      `${level} 프롤로그 — 시작\n\n첫 이야기\n\n## 1930년대 — 어린 시절\n\n연대 본문\n\n\`\`\`md\n# 에필로그 — 예시\n\`\`\`\n\n${level} 에필로그: 마무리\n\n마지막 이야기\n`
    )
    const { catalog } = run()
    assert.deepEqual(
      catalog.readingOrder.map(({ id }) => id),
      ['life-prologue', 'life-1930s', 'life-epilogue']
    )
    assert.equal(readPage('prologue.md').data.next.url, '/read/1930s.html')
    assert.equal(readPage('1930s.md').data.prev.url, '/read/prologue.html')
    assert.equal(readPage('1930s.md').data.next.url, '/read/epilogue.html')
    assert.equal(readPage('epilogue.md').data.prev.url, '/read/1930s.html')
    assert.equal(readPage('epilogue.md').data.next, null)
    assert.ok(readPage('prologue.md').content.includes('첫 이야기'))
    assert.ok(readPage('epilogue.md').content.includes('마지막 이야기'))
    assert.ok(!readPage('1930s.md').content.includes('마지막 이야기'))
  }
})

test('모든 연대 제목과 소제목, 마지막 제목을 바꿔도 기존 주소와 댓글 ID를 유지한다', (t) => {
  const { write, run, readPage } = fixture(t)
  const before = run().catalog.chapters
  const renamed = original
    .replace(/^## (\d{4})년대[^\n]*$/gm, '## $1년대: 새로 정리한 이야기')
    .replace(/^### .+$/gm, '### 새롭게 묶은 소재')
    .replace(/^## (?!\d{4}년대).+$/gm, '## 함께 돌아보는 삶')
  write(mainFilename, renamed)
  const after = run().catalog.chapters
  assert.deepEqual(
    after.map(({ id, url }) => ({ id, url })),
    before.map(({ id, url }) => ({ id, url }))
  )
  for (const chapter of after) {
    assert.equal(chapter.subtitle, '새로 정리한 이야기')
    const page = readPage(`${chapter.id.slice(5)}.md`)
    assert.equal(page.data.commentId, chapter.id)
    assert.equal(page.data.title, `${chapter.decade}: 새로 정리한 이야기`)
    assert.ok(page.content.includes('### 새롭게 묶은 소재'))
  }
  assert.equal(readPage('life-story.md').content.trimStart(), renamed)
})

test('새 연대도 원고에 놓인 순서대로 만들고 연대가 아닌 절과 코드블록은 분리한다', (t) => {
  const { write, run, readPage } = fixture(t)
  write(
    mainFilename,
    '# 소재\n\n소개\n\n## 2030년대：앞으로의 기억\n\n새 기록\n\n```md\n## 2040년대 — 예시\n```\n\n## 별도 정리\n\n전체에서만 읽는 정리\n\n## 1920년대 – 앞선 기억\n\n옛 기록\n\n## 1950년대\n\n또 다른 기록\n'
  )
  const { catalog } = run()
  assert.deepEqual(
    catalog.chapters.map(({ id }) => id),
    ['life-2030s', 'life-1920s', 'life-1950s']
  )
  assert.equal(catalog.chapters[0].subtitle, '앞으로의 기억')
  assert.equal(catalog.chapters[2].subtitle, '')
  assert.equal(readPage('2030s.md').data.next.url, '/read/1920s.html')
  assert.equal(readPage('1920s.md').data.prev.decade, '2030년대')
  assert.ok(!readPage('2030s.md').content.includes('전체에서만 읽는 정리'))
  assert.ok(readPage('life-story.md').content.includes('전체에서만 읽는 정리'))
})

test('중복 연대, 10년 단위가 아닌 연도, 연대가 없는 원고는 명확한 오류로 알린다', (t) => {
  const { write, run } = fixture(t)
  write(mainFilename, '# 소재\n\n## 2030년대: 하나\n\n본문\n\n## 2030년대 — 둘\n\n본문\n')
  assert.throws(run, /연대 제목 중복: 2030년대/)
  write(mainFilename, '# 소재\n\n## 2035년대 — 잘못된 연도\n\n본문\n')
  assert.throws(run, /10년 단위/)
  write(mainFilename, '# 소재\n\n## 삶의 정리\n\n본문\n')
  assert.throws(run, /연대 제목이 없습니다/)
})

test('연대 제목의 구분자를 바꿔도 표시 이름에서 연도가 중복되지 않는다', () => {
  for (const title of [
    '2030년대 — 새 이야기',
    '2030년대–새 이야기',
    '2030년대- 새 이야기',
    '2030년대: 새 이야기',
    '2030년대：새 이야기',
    '2030년대 새 이야기',
  ])
    assert.deepEqual(parseDecadeHeading(title), {
      year: '2030',
      label: '2030년대',
      subtitle: '새 이야기',
    })
  assert.deepEqual(parseDecadeHeading('2030년대'), {
    year: '2030',
    label: '2030년대',
    subtitle: '',
  })
  assert.equal(parseDecadeHeading('2035년대 — 이야기'), null)
  assert.equal(parseDecadeHeading('가족의 기억'), null)
})

test('전체글의 댓글 링크는 새 연대와 바뀐 제목에서도 같은 연대별 댓글 주소를 사용한다', async () => {
  const md = await createMarkdownRenderer(repo, {
    config(markdown) {
      decadeComments(markdown, { base: '/bae-memoir/', enabled: true })
    },
  })
  const source =
    '# 소재\n\n## 2030년대: 새 이야기\n\n본문\n\n```md\n## 2040년대 — 코드 예시\n```\n\n## 정리 제목 변경\n\n요약\n\n## 1930년대 – 다른 제목\n\n기억\n'
  const rendered = md.render(source, { frontmatter: { kind: 'full' } })
  const links = [...rendered.matchAll(/class="decade-comments-link"><a href="([^"]+)"/g)].map(
    (match) => match[1]
  )
  assert.deepEqual(links, [
    '/bae-memoir/read/2030s.html#comments',
    '/bae-memoir/read/1930s.html#comments',
  ])
  assert.ok(rendered.indexOf('2030s.html#comments') < rendered.indexOf('정리 제목 변경'))
  assert.ok(
    !md
      .render(source, { frontmatter: { kind: 'chapter' } })
      .includes('class="decade-comments-link"')
  )
})

test('루트와 content의 자료를 자동 발견하고 내용 수정에도 댓글 ID를 유지한다', (t) => {
  const { root, write, run, readPage } = fixture(t)
  write('할머니 이야기.md', '# 할머니 이야기\n\n어릴 적의 기억입니다.\n')
  write(
    'content/사진/이삿날.md',
    '---\nid: moving-day\ntitle: 이삿날의 기억\ncategory: 사진과 기억\ndate: 1977-04-01\n---\n# 이삿날\n\n비가 내렸습니다.\n'
  )
  const initial = run().catalog.documents
  assert.equal(initial.length, 2)
  const automatic = initial.find(({ title }) => title === '할머니 이야기')
  assert.match(automatic.id, /^doc-[a-f0-9]{12}$/)
  assert.equal(initial.find(({ id }) => id === 'moving-day').category, '사진과 기억')
  assert.equal(readPage('moving-day.md').data.commentId, 'moving-day')
  assert.equal(readPage('moving-day.md').data.date, '1977-04-01')
  write('할머니 이야기.md', '# 바뀐 제목\n\n기억을 더했습니다.\n')
  write('content/사진/이삿날.md', '---\nid: moving-day\n---\n# 고정 아이디\n\n내용도 바뀝니다.\n')
  const updated = run().catalog.documents
  assert.equal(updated.find(({ title }) => title === '바뀐 제목').id, automatic.id)
  assert.ok(existsSync(path.join(root, 'site/read', `${automatic.id}.md`)))
})

test('임시글, 운영 문서, 프로젝트 내부와 심볼릭 링크의 Markdown은 게시하지 않는다', (t) => {
  const { root, write, run } = fixture(t)
  for (const filename of [
    'README.md',
    'README.ko.md',
    'AGENTS.md',
    'SETUP.md',
    'DEPLOYMENT.md',
    '윤문제안서.md',
    'content/편집/윤문제안서.md',
    'site/manual.md',
    'scripts/notes.md',
    'node_modules/pkg/README.md',
    '.private.md',
    'content/.hidden/private.md',
  ])
    write(filename, '# 게시하면 안 되는 문서')
  write('content/draft.md', '---\npublished: false\n---\n# 미공개')
  write('content/draft2.md', '---\ndraft: true\n---\n# 초안')
  write('content/visible.md', '# 공개 기록')
  symlinkSync(path.join(root, 'content/visible.md'), path.join(root, 'linked.md'))
  const { catalog } = run()
  assert.deepEqual(
    catalog.documents.map(({ title }) => title),
    ['공개 기록']
  )
})

test('편집 제안서는 루트와 content에서 정확한 파일명으로만 제외하며 원본을 보존한다', (t) => {
  const { root, write, run } = fixture(t)
  const editorial = '# 편집 참고\n\n제안 내용은 사이트에 게시하지 않습니다.\n'
  const editorialNames = [
    '윤문제안서.md',
    '윤문제안서_최종.md',
    '사랑을_주제로_한_일대기_구성_개선_제안서.md',
  ]
  const editorialPaths = editorialNames.flatMap((filename) => [
    filename,
    `content/편집/${filename}`,
    `content/맥에서_추가/${filename.normalize('NFD')}`,
  ])
  for (const filename of editorialPaths) write(filename, editorial)
  write('content/윤문제안서_공개.md', '# 가족에게 공유할 제안')
  write('사랑을_주제로_한_일대기.md', '# 사랑을 주제로 한 일대기')
  write('content/가족_제안서.md', '# 가족의 제안')
  const { catalog, manifest } = run()
  assert.deepEqual(
    catalog.documents.map(({ title }) => title).sort(),
    ['가족에게 공유할 제안', '사랑을 주제로 한 일대기', '가족의 제안'].sort()
  )
  for (const filename of editorialPaths) {
    assert.ok(!manifest.sources.some(({ source }) => source === filename))
    assert.equal(readFileSync(path.join(root, filename), 'utf8'), editorial)
  }
})

test('중복 ID, 예약된 연대 ID와 충돌, 안전하지 않은 경로를 빌드 전에 거절한다', (t) => {
  const { write, run } = fixture(t)
  write('content/a.md', '---\nid: repeated\n---\n# 하나')
  write('content/b.md', '---\nid: repeated\n---\n# 둘')
  assert.throws(run, /문서 id 중복: repeated/)
  write('content/b.md', '---\nid: life-1930s\n---\n# 둘')
  assert.throws(run, /문서 id 중복: life-1930s/)
  write('content/b.md', '---\nid: 1930s\n---\n# 둘')
  assert.throws(run, /생성 경로 중복: 1930s.md/)
  for (const id of ['../escape', '/absolute', 'has space', '<script>', '한글', 'a'.repeat(81)]) {
    write('content/b.md', `---\nid: ${JSON.stringify(id)}\n---\n# 둘`)
    assert.throws(run, /안전하지 않은 문서 id/)
  }
})

test('자료와 첨부파일의 상대 링크를 게시 경로로 바꾸고 코드블록은 보존한다', (t) => {
  const { root, write, run, readPage } = fixture(t)
  write(
    'content/one.md',
    '---\nid: one\n---\n# 하나\n\n[둘](two.md#추억)\n\n![사진](사진/a.png)\n\n[전체](../배병희_자서전.md)\n\n[참고][two]\n\n[two]: two.md "둘"\n\n```md\n[예시](not-real.md)\n```\n'
  )
  write('content/two.md', '---\nid: two\n---\n# 둘\n\n## 추억\n')
  write('content/사진/a.png', Buffer.from([137, 80, 78, 71]))
  const { manifest, warnings } = run()
  const content = readPage('one.md').content
  assert.ok(content.includes('[둘](/read/two.html#추억)'))
  assert.ok(content.includes('[전체](/read/life-story.html)'))
  assert.ok(content.includes('[two]: /read/two.html "둘"'))
  assert.ok(content.includes('[예시](not-real.md)'))
  const attachment = manifest.files.find((filename) => filename.startsWith('assets/'))
  assert.ok(content.includes(`![사진](./${attachment})`))
  assert.ok(existsSync(path.join(root, 'site/read', attachment)))
  assert.deepEqual(warnings, [])
})

test('삭제된 생성 자료만 지우고 직접 작성한 페이지는 보존한다', (t) => {
  const { root, write, run } = fixture(t)
  write('content/extra.md', '---\nid: extra\n---\n# 별도 자료')
  run()
  write('site/read/manual.md', '# 직접 작성한 페이지')
  rmSync(path.join(root, 'content/extra.md'))
  run()
  assert.equal(existsSync(path.join(root, 'site/read/extra.md')), false)
  assert.equal(readFileSync(path.join(root, 'site/read/manual.md'), 'utf8'), '# 직접 작성한 페이지')
  write('content/manual.md', '---\nid: manual\n---\n# 자료')
  assert.throws(run, /직접 작성한 파일을 덮어쓰지 않습니다/)
})

test('목차용 소개와 제목에서 HTML 및 Markdown 문법을 제거한다', (t) => {
  const { write, run } = fixture(t)
  write(
    'content/about.md',
    '---\nid: about\ntitle: "<b>어머니</b>의 **기억**"\ndescription: "<script>alert(1)</script>우리의 [추억](./photo.png)입니다."\n---\n# 소개\n'
  )
  const document = run().catalog.documents[0]
  assert.equal(document.title, '어머니의 기억')
  assert.equal(document.description, '우리의 추억입니다.')
  assert.equal(plainText('<!-- 비공개 --><style>body{}</style>**기억**'), '기억')
  assert.equal(plainText('1972~1973년, 5~6kg, ~~지난 표현~~'), '1972~1973년, 5~6kg, 지난 표현')
})
