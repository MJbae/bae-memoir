import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

const PROJECT = 'demo-family-library'
const FIRESTORE = 'http://127.0.0.1:8080'
const AUTH = 'http://127.0.0.1:9099'
const documentsBase = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`

function mobileFamilyContext(browser: Browser) {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    reducedMotion: 'reduce',
    baseURL: 'http://127.0.0.1:4175',
  })
}

test.beforeEach(async ({ request }) => {
  // These are explicitly local demo data only. This suite never uses a real
  // Firebase project or credentials, even when a developer has .env.local.
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080')
  expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9099')
  const clearDocuments = await request.delete(
    `${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`
  )
  expect(clearDocuments.ok()).toBeTruthy()
  const clearAccounts = await request.delete(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`)
  expect(clearAccounts.ok()).toBeTruthy()
})

async function openReactions(page: Page) {
  await page.goto('/read/josae.html#reactions')
  await page.locator('#reactions').scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '응원해요', exact: true })).toBeEnabled()
  await expect(page.locator('.reaction-options button')).toHaveCount(4)
  await expect(page.getByRole('button', { name: '기억나요', exact: true })).toHaveCount(0)
  await expect(page.locator('.reaction-error')).toHaveCount(0)
}
async function storedReactions(request: APIRequestContext) {
  const response = await request.get(`${documentsBase}/pages/memoir-ep-josae/reactions`, { headers: { Authorization: 'Bearer owner' } })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).documents || []
}

test('Firebase가 연결되어도 댓글 화면과 요청은 없고 회차 반응은 유지한다', async ({ page }) => {
  const commentRequests: string[] = []
  page.on('request', request => {
    if (/\/comments(?:\/|\?|$)/.test(request.url())) commentRequests.push(request.url())
  })
  await page.goto('/')
  await expect(page.getByRole('link', { name: '한 번에 읽기', exact: true })).toHaveCount(0)
  await openReactions(page)
  await expect(page.locator('#comments, .family-comments, .comment-composer')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await page.locator('.next-episode').click()
  await expect(page).toHaveURL(/jige\.html$/)
  await page.locator('#reactions').scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '좋아요', exact: true })).toBeEnabled()
  await expect(page.locator('#comments, .family-comments, .comment-composer')).toHaveCount(0)
  expect(commentRequests).toEqual([])
})

test('episode reactions coalesce clicks, persist across browsers, switch, cancel, and survive next-episode navigation', async ({ page, request, browser }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await openReactions(page)
  expect(await storedReactions(request)).toHaveLength(0)
  const optionsBefore = await page.locator('.reaction-options').boundingBox()
  await page.getByRole('button', { name: '응원해요', exact: true }).click()
  await page.getByRole('button', { name: '좋아요', exact: true }).click()
  await expect.poll(async () => (await storedReactions(request))[0]?.fields.like.integerValue).toBe('1')
  expect((await storedReactions(request))[0].fields.heart.integerValue).toBe('0')
  expect((await page.locator('.reaction-options').boundingBox())!.height).toBe(optionsBefore!.height)
  const context = await mobileFamilyContext(browser)
  try {
    const other = await context.newPage()
    await openReactions(other)
    await expect(other.getByRole('button', { name: '좋아요 1', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.reload(); await page.locator('#reactions').scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: '좋아요 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: '좋아요 1', exact: true }).click()
    await expect.poll(async () => (await storedReactions(request))[0]?.fields.like.integerValue).toBe('0')
    // An old selection remains valid data but must not surface as a fifth option.
    const stored = (await storedReactions(request))[0]
    const seeded = await request.patch(`${FIRESTORE}/v1/${stored.name}`, {
      headers: { Authorization: 'Bearer owner' },
      data: { fields: { heart: { integerValue: '0' }, like: { integerValue: '0' }, moved: { integerValue: '0' }, wow: { integerValue: '0' }, remember: { integerValue: '1' }, updatedAt: { timestampValue: new Date(Date.now() - 2000).toISOString() } } },
    })
    expect(seeded.ok()).toBeTruthy()
    await page.reload(); await page.locator('#reactions').scrollIntoViewIfNeeded()
    await expect(page.locator('.reaction-options button[aria-pressed="true"]')).toHaveCount(0)
    await expect(page.locator('.remember-hint')).toHaveCount(0)
    await page.getByRole('button', { name: '대단해요', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/reactions/reactions-320.png', fullPage: true })
    await page.locator('.next-episode').click()
    await expect(page).toHaveURL(/jige\.html$/)
    await expect.poll(async () => (await storedReactions(request))[0]?.fields.wow.integerValue).toBe('1')
    expect((await storedReactions(request))[0].fields.remember.integerValue).toBe('0')
  } finally { await context.close() }
})
