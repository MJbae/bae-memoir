import { expect, test, type Page } from '@playwright/test'
import { legacyEpisodes } from '../site/.vitepress/shared/episode-heading.mjs'
import rawCatalog from '../site/.vitepress/generated/catalog.json' with { type: 'json' }
import type { Illustration } from '../site/.vitepress/markdown/episode-illustrations'
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true) }

test('작품 홈의 26편 목록과 처음부터 읽기에서 원고를 읽는다', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '내 논을 파는 한이 있어도', exact: true })).toBeVisible()
  await expect(page.locator('.chapter-row')).toHaveCount(26)
  await expect(page.locator('.part-heading')).toHaveCount(6)
  await expect(page.getByRole('navigation', { name: '부별 바로가기' })).toHaveCount(0)
  await expect(page.locator('.work-synopsis')).toContainText('3억 원')
  await expect(page.locator('.resume-link')).toHaveText('처음부터 읽기')
  await expect(page.getByRole('link', { name: '한 번에 읽기', exact: true })).toHaveCount(0)
  const synopsis = (await page.locator('.work-synopsis').boundingBox())!
  const action = (await page.locator('.resume-link').boundingBox())!
  const chapters = (await page.locator('.chapter-list').boundingBox())!
  expect(action.y).toBeGreaterThanOrEqual(synopsis.y + synopsis.height)
  expect(chapters.y).toBeGreaterThanOrEqual(action.y + action.height)
  expect(action.y - synopsis.y - synopsis.height).toBeLessThanOrEqual(32)
  expect(chapters.y - action.y - action.height).toBeLessThanOrEqual(40)
  await noOverflow(page)
  await page.screenshot({ path: `test-results/reading/${info.project.name}-home.png`, fullPage: true })
  await page.locator('.resume-link').click()
  await expect(page).toHaveURL(/read\/prologue\.html$/)
  await expect(page.locator('.article-header h1')).toHaveText('벼 한 톨의 무게')
  await expect(page.locator('.story-content')).toContainText('내 논을 파는 한이 있어도')
  await expect(page.locator('.reader-toolbar a, .reader-toolbar button')).toHaveCount(2)
  await expect(page.locator('#comments, #reactions')).toHaveCount(0)
  await noOverflow(page)
  expect(errors).toEqual([])
})

test('다음 화·읽음·읽던 화를 연결하고 목록의 해당 줄로 돌아간다', async ({ page }) => {
  await page.goto('read/prologue.html')
  await expect(page.locator('.previous-episode')).toHaveCount(0)
  await expect(page.locator('.episode-navigation')).toHaveCount(1)
  await expect(page.locator('.next-episode-action')).toHaveText('다음 화 읽기')
  await expect(page.locator('.next-episode-title')).toHaveText('1화 · 어머니의 조새')
  await page.locator('.next-episode').scrollIntoViewIfNeeded()
  await page.locator('.next-episode').click()
  await expect(page).toHaveURL(/read\/josae\.html$/)
  await expect(page.locator('.article-label')).toHaveText('1부 갯벌 · 1화')
  await expect(page.locator('.article-time')).toContainText('안면도 중장리')
  await expect(page.locator('.previous-episode')).toHaveCount(1)
  await expect(page.locator('.previous-episode')).toHaveAttribute('href', '/bae-memoir/read/prologue.html')
  await expect(page.locator('.episode-end').getByRole('link', { name: '목록', exact: true })).toHaveCount(0)
  await page.locator('.next-episode').scrollIntoViewIfNeeded()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('family-library:completed') || '[]'))).toContain('ep-josae')
  await page.locator('.back-link').click()
  await expect(page).toHaveURL(/#episode-josae$/)
  await expect(page.locator('#episode-josae')).toContainText('읽던 화')
  await expect(page.locator('#episode-josae .read-label')).toHaveText('✓')
  await expect(page.locator('#episode-josae').getByRole('img', { name: '읽은 회차' })).toBeVisible()
  await expect(page.locator('#episode-josae')).not.toContainText('읽음')
  await expect(page.locator('.resume-link')).toContainText('다음 화 읽기')
  await expect(page.locator('.resume-link')).toContainText('2화 책보 대신 지게')
  await page.locator('.resume-link').click()
  await expect(page).toHaveURL(/read\/jige\.html$/)
})

test('이전·다음 회차는 모든 글자 크기에서 같은 줄과 크기로 나란히 표시한다', async ({ page }, info) => {
  await page.goto('read/josae.html')
  for (const label of ['보통', '크게', '더 크게', '가장 크게']) {
    await page.getByRole('button', { name: '보기 설정', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click()
    await page.keyboard.press('Escape')
    const previous = page.locator('.previous-episode')
    const next = page.locator('.next-episode')
    await previous.scrollIntoViewIfNeeded()
    const left = (await previous.boundingBox())!, right = (await next.boundingBox())!
    expect(Math.abs(left.y - right.y)).toBeLessThan(1)
    expect(Math.abs(left.height - right.height)).toBeLessThan(1)
    expect(Math.abs(left.width - right.width)).toBeLessThan(1)
    expect(left.x + left.width).toBeLessThan(right.x)
    expect(await previous.evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(await next.evaluate(element => getComputedStyle(element).backgroundColor))
    await noOverflow(page)
  }
  await page.locator('.episode-navigation').screenshot({ path: `test-results/reading/${info.project.name}-episode-navigation.png` })
  await page.locator('.previous-episode').click()
  await expect(page).toHaveURL(/read\/prologue\.html$/)
  await expect(page.locator('.previous-episode')).toHaveCount(0)
})

test('읽던 위치와 네 단계 글자 크기를 기억한다', async ({ page }) => {
  await page.goto('read/josae.html')
  await page.getByRole('button', { name: '보기 설정', exact: true }).click()
  const settings = page.getByRole('dialog')
  await settings.getByRole('button', { name: '가장 크게', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('.library')).toHaveClass(/font-3/)
  await expect(page.locator('.story-content p').first()).toHaveCSS('font-size', '26px')
  await expect(page.locator('.reader-actions button')).toHaveCSS('font-size', '18px')
  await page.evaluate(() => window.scrollTo({ top: 260, behavior: 'instant' }))
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('family-library:reading') || '{}').scroll)).toBeGreaterThan(200)
  const back = await page.locator('.back-link').boundingBox()
  // Click the visible sticky toolbar: Playwright's automatic scrollIntoView can move it to document top.
  await page.mouse.click(back!.x + back!.width / 2, back!.y + back!.height / 2)
  await expect(page.locator('.resume-link')).toContainText('이어서 읽기')
  await page.locator('.resume-link').click()
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200)
  await noOverflow(page)
})

test('옛 연대 읽기 기록을 새 회차의 제목과 주소로 읽는다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('family-library:reading', JSON.stringify({ id: 'life-1980s', title: '옛 제목', url: '/read/1980s.html', scroll: 1800 })))
  await page.goto('./')
  await expect(page.locator('.resume-link')).toContainText('12화 가족은 반대했다')
  await expect(page.locator('.resume-link')).toHaveAttribute('href', '/bae-memoir/read/rice-mill.html')
  await page.locator('.resume-link').click()
  await expect(page.locator('.article-header h1')).toHaveText('가족은 반대했다')
})

test('기기 화면 모드와 직접 고른 화면 모드를 적용하고 기억한다', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('read/josae.html')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim())).toBe('#1c1c1e')
  await page.getByRole('button', { name: '보기 설정', exact: true }).click()
  await page.getByRole('button', { name: '밝게', exact: true }).click()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim())).toBe('#ffffff')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: '보기 설정', exact: true }).click()
  await page.getByRole('button', { name: '어둡게', exact: true }).click()
  await page.getByRole('button', { name: '가장 크게', exact: true }).click()
  await page.keyboard.press('Escape')
  await noOverflow(page)
  await page.locator('.next-episode').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `test-results/reading/${info.project.name}-dark-reader.png`, fullPage: true })
})

test('키보드로 보기 설정을 열고 닫는다', async ({ page }) => {
  await page.goto('read/josae.html')
  const trigger = page.getByRole('button', { name: '보기 설정', exact: true })
  await trigger.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '보통', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(page.locator('.library')).toHaveClass(/font-0/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(trigger).toBeFocused()
})

test('23화에서 에필로그·외전·목록까지 이어진다', async ({ page }) => {
  await page.goto('read/robot.html')
  await page.locator('.next-episode').click()
  await expect(page).toHaveURL(/read\/epilogue\.html$/)
  await page.locator('.next-episode').click()
  await expect(page).toHaveURL(/read\/side-table\.html$/)
  await expect(page.locator('.next-episode')).toHaveText('전체 회차 보기')
  await expect(page.locator('.next-episode-title')).toHaveCount(0)
  await expect(page.locator('.episode-end').getByRole('link', { name: '목록', exact: true })).toHaveCount(0)
  await page.locator('.next-episode').click()
  await expect(page.locator('.resume-link')).toContainText('처음부터 다시 읽기')
  await expect(page.getByRole('link', { name: '한 번에 읽기', exact: true })).toHaveCount(0)
  await noOverflow(page)
})

test('옛 주소 열 개는 자바스크립트 없이 해당 회차로 이동한다', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    for (const [old, id] of Object.entries(legacyEpisodes)) {
      await page.goto(`http://127.0.0.1:4183/bae-memoir/read/${old}.html`)
      await expect(page).toHaveURL(new RegExp(`read/${id}\\.html$`))
      await expect(page.locator('.article-header h1')).toBeVisible()
    }
  } finally { await context.close() }
})

test('모든 회차의 삽화를 불러오며 16:9 전체 그림을 화면 폭에 맞춘다', async ({ page }, info) => {
  test.setTimeout(90000)
  const images = rawCatalog.illustrations as Record<string, Illustration[]>
  expect(Object.keys(images)).toHaveLength(26)
  expect(Object.values(images).flat()).toHaveLength(32)
  const broken: string[] = []
  page.on('response', response => {
    if (response.url().includes('/images/episodes/') && !response.ok()) broken.push(response.url())
  })
  for (const [episodeId, illustrations] of Object.entries(images)) {
    await page.goto(`read/${episodeId}.html`)
    const body = await page.locator('.story-content').innerText()
    expect(body, `${episodeId} 본문에 마크다운 기호가 노출되지 않아야 합니다.`).not.toMatch(/\*\*|__|~~|`|\[[^\]]+\]\(/)
    if (episodeId === 'bearing') expect(body).toContain("'메다르(메탈 베어링)'가")
    const figures = page.locator('.episode-illustration')
    await expect(figures).toHaveCount(illustrations.length)
    for (const illustration of illustrations) {
      const image = page.locator(`[data-illustration="${illustration.id}"] img`)
      await image.scrollIntoViewIfNeeded()
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
      expect(await image.evaluate((element: HTMLImageElement) => element.currentSrc)).toMatch(/\.webp$/)
      await expect(image).toHaveAttribute('alt', illustration.alt)
      await expect(image).toHaveAttribute('width', '1280')
      await expect(image).toHaveAttribute('height', '720')
      const box = (await image.boundingBox())!
      expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.005)
    }
    await noOverflow(page)
  }
  expect(broken).toEqual([])
  await page.goto('read/josae.html')
  await page.screenshot({ path: `test-results/reading/${info.project.name}-illustrated-reader.png`, fullPage: true })
})

test('삽화는 자바스크립트 없이 회차에서 표시된다', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  try {
    await page.goto('http://127.0.0.1:4183/bae-memoir/read/josae.html')
    await expect(page.locator('.episode-illustration')).toHaveCount(2)
    const first = page.locator('.episode-illustration img').first()
    await expect.poll(() => first.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await page.goto('http://127.0.0.1:4183/bae-memoir/read/life-story.html')
    await expect(page).toHaveURL('http://127.0.0.1:4183/bae-memoir/')
    await expect(page.locator('.work-synopsis')).toBeVisible()
    await expect(page.locator('.chapter-row')).toHaveCount(26)
  } finally { await context.close() }
})
