import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { parseDecadeHeading } from '../site/.vitepress/shared/decade-heading.mjs'

const manuscript = readFileSync(new URL('../배병희_자서전.md', import.meta.url), 'utf8')
const sourceHeadings = [...manuscript.matchAll(/^## (.+)$/gm)].map((match) => match[1])
const chapters = sourceHeadings.map(parseDecadeHeading).filter((heading) => heading !== null)
const first = chapters[0]
const firstTitle = sourceHeadings.find((title) => parseDecadeHeading(title))!
const firstParagraph = manuscript
  .slice(manuscript.indexOf(`## ${firstTitle}`))
  .split(/\n\s*\n/)
  .find((paragraph) => !paragraph.startsWith('#'))!

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

test('간결한 이야기 목록에서 연대를 골라 원문을 읽는다', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '아버지의 기록', exact: true })).toBeVisible()
  const chapterList = page.getByRole('navigation', { name: '연대별 이야기', exact: true })
  await expect(chapterList.locator('a.chapter-row')).toHaveCount(chapters.length + 2)
  await expect(page.locator('.resume-link')).toHaveCount(0)
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expect(page.getByRole('group', { name: '자료 종류' })).toHaveCount(0)
  await expect(page.locator('#documents')).toHaveCount(0)
  await expect(page.locator('.site-footer, .mobile-reader-bar')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: `test-results/${info.project.name}-home.png`, fullPage: true })

  const firstChapter = chapterList.locator(`a[href$="/read/${first.year}s.html"]`)
  const touchTarget = await firstChapter.boundingBox()
  expect(touchTarget?.height).toBeGreaterThanOrEqual(44)
  await firstChapter.click()
  await expect(page).toHaveURL(new RegExp(`/read/${first.year}s\\.html$`))
  await expect(page.locator('.story-content')).toContainText(firstParagraph.replace(/\*\*/g, ''))
  await expect(page.locator('.article-header h1')).toHaveText(first.subtitle || first.label)
  await expect(page.locator('.story-content h1')).toBeHidden()
  await expect(page.getByRole('link', { name: '목록', exact: true })).toBeVisible()
  await expect(page.locator('#comments')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /댓글/ })).toHaveCount(0)
  await expect(page.getByText(/댓글을 준비하고 있어요/)).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: `test-results/${info.project.name}-reader.png`, fullPage: true })
  expect(errors).toEqual([])
})

test('목록에서 프롤로그와 에필로그를 읽고 연대 본문으로 이동한다', async ({ page }) => {
  await page.goto('./')
  await page.locator('a.chapter-row[href$="/read/prologue.html"]').click()
  await expect(page.locator('.article-header h1')).toContainText('프롤로그')
  await expect(page.locator('.story-content')).toContainText('내 논을 파는 한이 있어도')
  await page.locator('.next-chapter').click()
  await expect(page).toHaveURL(new RegExp(`/read/${first.year}s\\.html$`))
  await page.goto('read/2020s.html')
  await expect(page.locator('.story-content')).not.toContainText(
    '다시 젊어져도 나는 이 길을 걷겠다'
  )
  await page.locator('.next-chapter').click()
  await expect(page).toHaveURL(/read\/epilogue\.html$/)
  await expect(page.locator('.article-header h1')).toContainText('에필로그')
  await expect(page.locator('.story-content')).toContainText(
    '다시 태어나도 나는 흙을 일구고 정미소 일을 하겠다'
  )
  await expectNoHorizontalOverflow(page)
})

test('이어서 읽기에 저장된 옛 제목도 현재 원고의 제목으로 보여 준다', async ({ page }) => {
  await page.addInitScript((year) => {
    localStorage.setItem(
      'family-library:reading',
      JSON.stringify({
        id: `life-${year}s`,
        title: '수정하기 전의 제목',
        url: `/read/${year}s.html`,
        scroll: 0,
        progress: 10,
      })
    )
  }, first.year)
  await page.goto('./')
  const resume = page.locator('.resume-link')
  await expect(resume.locator('.resume-title')).toHaveText(first.subtitle || first.label)
  await expect(resume).toHaveAttribute('href', `/bae-memoir/read/${first.year}s.html`)
  await resume.click()
  await expect(page.locator('.article-header h1')).toHaveText(first.subtitle || first.label)
})

test('큰 글씨와 읽던 위치를 기억한다', async ({ page }) => {
  await page.goto('read/1980s.html')
  await expect(page.locator('.story-content')).toContainText('새마을정미소')
  await page.getByRole('button', { name: '글자 크기', exact: true }).click()
  const settings = page.locator('.reading-settings')
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: '더 크게', exact: true }).click()
  await expect(page.locator('.library')).toHaveClass(/font-2/)
  await page.reload()
  await expect(page.locator('.library')).toHaveClass(/font-2/)
  await expectNoHorizontalOverflow(page)

  await expect(page.getByRole('button', { name: '목차', exact: true })).toHaveCount(0)
  const sections = page.locator('.story-content h3')
  await sections.nth(Math.floor((await sections.count()) / 2)).scrollIntoViewIfNeeded()
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('family-library:reading') || 'null')?.progress
      )
    )
    .toBeGreaterThan(0)
  const previous = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('family-library:reading') || '{}')
  )
  await page.locator('.back-link').click()
  await expect(page.locator('.resume-link')).toBeVisible()
  await page.locator('.resume-link').click()
  await expect(page).toHaveURL(/1980s\.html/)
  await expect.poll(async () => page.evaluate(() => scrollY)).toBeGreaterThan(previous.scroll * 0.8)
  await expect(page.locator('#comments')).toHaveCount(0)
})

test('키보드로 글자 크기를 조절하고 설정을 닫을 수 있다', async ({ page }) => {
  await page.goto('read/1980s.html')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '본문으로 건너뛰기' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '목록', exact: true })).toBeFocused()

  const fontTrigger = page.getByRole('button', { name: '글자 크기', exact: true })
  await fontTrigger.focus()
  await page.keyboard.press('Enter')
  const settings = page.locator('.reading-settings')
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: '보통', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.library')).toHaveClass(/font-0/)
  await expectNoHorizontalOverflow(page)
  await page.keyboard.press('Escape')

  await expect(settings).not.toBeVisible()
  await expect(fontTrigger).toBeFocused()
  await expect(page.getByRole('button', { name: '목차', exact: true })).toHaveCount(0)
  await expect(page.locator('#toc-dialog')).toHaveCount(0)
})

test('전체 글을 한 번에 읽고 잘못된 주소에서 목록으로 돌아온다', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('link', { name: '전체 이야기 보기', exact: true }).click()
  await expect(page).toHaveURL(/\/read\/life-story\.html$/)
  await expect(page.locator('.story-content h2')).toHaveCount(sourceHeadings.length)
  await expect(page.locator('.story-content h2').last()).toContainText(sourceHeadings.at(-1)!)
  await expectNoHorizontalOverflow(page)

  await page.goto('missing-page.html')
  await expect(page.getByRole('heading', { name: '이야기를 찾지 못했습니다.' })).toBeVisible()
  await page.getByRole('link', { name: '목록으로 돌아가기', exact: true }).click()
  await expect(page.locator('.chapter-row')).toHaveCount(chapters.length + 2)
})
