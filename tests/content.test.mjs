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
import { createMarkdownRenderer, disposeMdItInstance } from 'vitepress'
import { prepareContent, plainText } from '../scripts/prepare-content.mjs'
import { parseManuscript, legacyEpisodes } from '../site/.vitepress/shared/episode-heading.mjs'
import { episodeIllustrations } from '../site/.vitepress/markdown/episode-illustrations.ts'
import { loadMusic } from '../site/.vitepress/shared/music.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainFilename = '배병희_자서전.md'
const original = readFileSync(path.join(repo, mainFilename), 'utf8')
const silent = { log() {}, warn() {} }

test('27개 음악 파일을 작품 홈과 26개 회차에 빠짐없이 연결한다', () => {
  const episodes = parseManuscript(matter(original).content).episodes
  const music = loadMusic(repo, episodes)
  assert.equal(music.home.src, '/music/home.mp3')
  assert.equal(Object.keys(music.episodes).length, 26)
  const allSources = [music.home.src, ...Object.values(music.episodes).map(track => track.src)]
  assert.equal(new Set(allSources).size, 27)
  for (const episode of episodes) {
    assert.equal(music.episodes[episode.id].label, `${episode.label} 음악`)
    assert.ok(existsSync(path.join(repo, 'site/public', music.episodes[episode.id].src)))
  }
  const reordered = loadMusic(repo, episodes.map(episode => ({ ...episode, label: `새 순서 ${episode.label}` })).reverse())
  assert.equal(reordered.episodes.josae.src, music.episodes.josae.src)
  assert.equal(reordered.episodes.josae.label, '새 순서 1화 음악')
})

test('누락·중복·잘못된 회차·미등록 음악 파일을 준비 단계에서 거절한다', t => {
  const { root, write } = fixture(t)
  const episodes = [{ id: 'prologue', label: '프롤로그' }]
  const base = { version: 1, home: '/music/home.mp3', tracks: [{ episodeId: 'prologue', src: '/music/prologue.mp3' }] }
  const manifest = value => write('content/music.json', JSON.stringify(value))
  write('site/public/music/home.mp3', 'test-home')
  write('site/public/music/prologue.mp3', 'test-prologue')
  manifest(base)
  assert.ok(loadMusic(root, episodes))
  manifest({ ...base, home: '/music/missing.mp3' })
  assert.throws(() => loadMusic(root, episodes), /파일이 없습니다/)
  manifest({ ...base, home: '/music/../home.mp3' })
  assert.throws(() => loadMusic(root, episodes), /경로/)
  manifest({ ...base, tracks: [] })
  assert.throws(() => loadMusic(root, episodes), /회차의 배경 음악이 없습니다/)
  manifest({ ...base, tracks: [...base.tracks, ...base.tracks] })
  assert.throws(() => loadMusic(root, episodes), /회차.*중복/)
  manifest({ ...base, tracks: [{ episodeId: 'unknown', src: '/music/prologue.mp3' }] })
  assert.throws(() => loadMusic(root, episodes), /회차.*잘못/)
  manifest({ ...base, tracks: [{ episodeId: 'prologue', src: base.home }] })
  assert.throws(() => loadMusic(root, episodes), /파일 경로.*중복/)
  manifest(base)
  write('site/public/music/extra.mp3', 'unassigned')
  assert.throws(() => loadMusic(root, episodes), /연결하지 않은 음악/)
})

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

test('6부 23화와 앞뒤 회차를 생성하고 정본의 모든 본문을 한 번씩 보존한다', (t) => {
  const { root, run, readPage } = fixture(t)
  const { catalog } = run()
  const structure = parseManuscript(matter(original).content)
  assert.equal(catalog.parts.length, 6)
  assert.equal(catalog.chapters.length, 23)
  assert.equal(catalog.readingOrder.length, 26)
  assert.equal(readFileSync(path.join(root, mainFilename), 'utf8'), original)
  for (const [i, episode] of structure.episodes.entries()) {
    const page = readPage(`${episode.id}.md`)
    assert.equal(page.content.trim(), `# ${episode.title}\n\n${episode.body}`.trim())
    assert.equal(page.data.time, episode.time)
    assert.equal(page.data.label, episode.label)
    assert.equal(page.data.prev?.url ?? null, catalog.readingOrder[i-1]?.url ?? null)
    assert.equal(page.data.next?.url ?? null, catalog.readingOrder[i+1]?.url ?? null)
  }
  assert.equal(readPage('prologue.md').data.pageId, 'life-prologue')
  assert.equal(readPage('epilogue.md').data.pageId, 'life-epilogue')
  assert.equal(readPage('josae.md').data.pageId, 'ep-josae')
})

test('제목과 순서를 바꿔도 회차 주소와 문서 ID는 그대로이고 번호는 원고 순서를 따른다', (t) => {
  const { write, run } = fixture(t)
  const before = run().catalog.readingOrder
  const body = matter(original).content
  const first = body.indexOf('## 어머니의 조새'), second = body.indexOf('## 책보 대신 지게'), third = body.indexOf('## 열두 자리 숫자')
  write(mainFilename, original.slice(0, original.indexOf(body)) + body.slice(0, first) + body.slice(second, third) + body.slice(first, second).replace('어머니의 조새', '갯벌의 어머니') + body.slice(third))
  const after = run().catalog.readingOrder
  for (const episode of before) {
    const updated = after.find(e => e.episodeId === episode.episodeId)
    assert.equal(updated.url, episode.url)
    assert.equal(updated.id, episode.id)
  }
  assert.equal(after.find(e => e.episodeId === 'jige').label, '1화')
  assert.equal(after.find(e => e.episodeId === 'josae').label, '2화')
})

test('누락·잘못된·중복 ID, 부 번호, 시점 줄, 예약 ID, 본문 누락을 거절한다', (t) => {
  const { write, run } = fixture(t)
  for (const [from, to, error] of [
    [' {#josae}', '', /회차 ID/],
    ['{#josae}', '{#bad_id}', /회차 ID/],
    ['{#jige}', '{#josae}', /ID 중복/],
    ['{#josae}', '{#1930s}', /예약된/],
    ['{#josae}', '{#prologue}', /예약 ID|ID 중복/],
    ['# 2부. 가마솥', '# 3부. 가마솥', /부 번호/],
    ['*1940년대 · 안면도 중장리*', '시점 없음', /시점 줄/],
    ['*1940년대 · 안면도 중장리*', `*${'가'.repeat(41)}*`, /시점 줄/],
  ]) { write(mainFilename, original.replace(from, to)); assert.throws(run, error) }
  write(mainFilename, '# 1부. 갯벌\n\n## 제목 {#one}\n\n*1940년*\n')
  assert.throws(run, /본문이 비어/)
})

test('새 회차와 외전은 자동 번호를 받으며 코드 예시는 구조로 해석하지 않는다', (t) => {
  const { write, run } = fixture(t)
  write(mainFilename, original.replace('## 에필로그.', '## 새 장면 {#new-scene}\n\n*2010년대*\n\n새 본문입니다.\n\n```md\n## 예시 {#example}\n```\n\n## 에필로그.') + '\n## 외전. 두 번째 밥상 {#side-two}\n\n*가족의 기억*\n\n새 기억입니다.\n')
  const order = run().catalog.readingOrder
  assert.equal(order.find(e => e.episodeId === 'new-scene').number, 24)
  assert.equal(order.some(e => e.episodeId === 'example'), false)
  assert.equal(order.find(e => e.episodeId === 'side-table').label, '외전 1화')
  assert.equal(order.at(-1).label, '외전 2화')
})

test('회차 안의 소제목은 본문을 보존하고 경고한다', (t) => {
  const { write, run } = fixture(t)
  write(mainFilename, original.replace('## 책보 대신 지게', '### 남아 있는 소제목\n\n## 책보 대신 지게'))
  assert.match(run().warnings.join('\n'), /소제목/)
})

test('옛 주소 10개와 읽기 기록 ID를 새 회차로 대응한다', (t) => {
  const { run, readPage } = fixture(t)
  const { catalog } = run()
  for (const [old, id] of Object.entries(legacyEpisodes)) {
    const page = readPage(`${old}.md`)
    assert.equal(page.data.redirect, `/read/${id}.html`)
    assert.equal(page.data.pageId, '')
    assert.ok(page.content.includes(`/read/${id}.html`))
    assert.equal(catalog.legacyIds[`life-${old}`], `ep-${id}`)
  }
})

test('한 번에 읽기 주소는 본문 없이 작품 홈으로 연결하고 목록에서 제거한다', t => {
  const { run, readPage } = fixture(t)
  const { catalog } = run()
  const retired = readPage('life-story.md')
  assert.equal(retired.data.kind, 'redirect')
  assert.equal(retired.data.redirect, '/')
  assert.equal(retired.data.pageId, '')
  assert.equal(retired.content.trim(), '[작품 소개와 회차 목록으로 이동하기](/)')
  assert.ok(!Object.hasOwn(catalog, 'fullStory'))
})

test('루트와 content의 자료를 자동 발견하고 내용 수정에도 문서 ID를 유지한다', (t) => {
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
  assert.equal(readPage('moving-day.md').data.pageId, 'moving-day')
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
    '웹소설형_연재_개편_제안서.md',
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
    '웹소설형_연재_개편_제안서.md',
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

test('중복 ID, 예약된 회차 ID와 충돌, 안전하지 않은 경로를 빌드 전에 거절한다', (t) => {
  const { write, run } = fixture(t)
  write('content/a.md', '---\nid: repeated\n---\n# 하나')
  write('content/b.md', '---\nid: repeated\n---\n# 둘')
  assert.throws(run, /문서 id 중복: repeated/)
  write('content/b.md', '---\nid: ep-josae\n---\n# 둘')
  assert.throws(run, /문서 id 중복: ep-josae/)
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
  assert.ok(content.includes('[전체](/)'))
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

test('삽화는 원문·장면 구분을 보존하며 회차의 지정 문단 앞에 표시한다', async () => {
  disposeMdItInstance()
  const source = '# 회차\n\n첫 문단입니다.\n\n* * *\n\n다음 장면입니다.\n'
  const image = { id: 'scene', episodeId: 'sample', alt: '손과 벼를 그린 수채화', width: 1280, height: 720,
    sources: [360, 720, 1280].map(width => ({ src: `/images/episodes/scene-${width}.jpg`, width })) }
  const images = { sample: [
    { ...image, position: { start: true } },
    { ...image, id: 'second', alt: '두 번째 장면', position: { beforeParagraph: '다음 장면입니다.' } },
  ] }
  const md = await createMarkdownRenderer(path.join(repo, 'illustrations-renderer'), {
    config(md) { md.set({ html: false }); md.use(episodeIllustrations, { base: '/test/', images }) },
  })
  const render = (text, kind = 'episode') => md.render(text, { frontmatter: { kind, episodeId: 'sample' } })
  const html = render(source)
  assert.equal((html.match(/<figure /g) || []).length, 2)
  assert.ok(html.indexOf('data-illustration="scene"') < html.indexOf('첫 문단입니다.'))
  assert.ok(html.indexOf('<hr>') < html.indexOf('data-illustration="second"'))
  assert.ok(html.indexOf('data-illustration="second"') < html.indexOf('다음 장면입니다.'))
  assert.match(html, /:src="&quot;\/test\/images\/episodes\/scene-1280.jpg&quot;"/)
  assert.match(html, /scene-360.jpg 360w, \/test\/images\/episodes\/scene-720.jpg 720w/)
  assert.equal((html.match(/loading="eager"/g) || []).length, 1)
  assert.equal((html.match(/loading="lazy"/g) || []).length, 1)
  assert.equal(html.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>\n/g, ''), render(source, 'document'))
  assert.equal((render(source + '\n```md\n다음 장면입니다.\n```\n').match(/data-illustration="second"/g) || []).length, 1)
  assert.ok(!render(source, 'document').includes('<figure'))
  disposeMdItInstance()
})

test('삽화 문단이 바뀌거나 파일이 빠지면 조용히 누락하지 않고 준비 단계에서 알린다', t => {
  const { write, run } = fixture(t)
  const structure = parseManuscript(matter(original).content)
  const images = structure.episodes.map(episode => ({ id: episode.id, episodeId: episode.id, alt: '원고 장면의 수채화', width: 1280, height: 720, position: { start: true },
    sources: [360, 720, 1280].map(width => ({ src: `/images/episodes/${episode.id}-${width}.jpg`, width })) }))
  for (const image of images) for (const source of image.sources) write(`site/public${source.src}`, 'fixture')
  const manifest = () => write('content/episode-illustrations.json', JSON.stringify({ version: 1, images }))
  manifest()
  assert.equal(Object.keys(run().catalog.illustrations).length, 26)
  images[0].position = { beforeParagraph: '없는 문단' }; manifest()
  assert.throws(run, /원문 문단을 찾을 수 없습니다/)
  images[0].position = { start: true }
  images[0].sources[0].src = '/images/episodes/missing-360.jpg'; manifest()
  assert.throws(run, /안전하지 않은 삽화 파일 경로/)
  images[0].sources[0].src = '/images/episodes/prologue-360.jpg'; manifest()
  images.pop(); manifest()
  assert.throws(run, /대표 삽화가 없습니다/)
})
