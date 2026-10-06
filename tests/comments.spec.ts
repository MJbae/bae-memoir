import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const manuscript = readFileSync(new URL('../배병희_자서전.md', import.meta.url), 'utf8')
const sourceDecades = [...manuscript.matchAll(/^## (\d{4})년대(?=$|[\s:：—–-])/gm)].map(
  (match) => match[1]
)

const PROJECT = 'demo-family-library'
const FIRESTORE = 'http://127.0.0.1:8080'
const AUTH = 'http://127.0.0.1:9099'
const documentsBase = `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`
const commentsFor = (pageId: string) => `${documentsBase}/pages/${pageId}/comments`

async function openComments(page: Page, decade = '1930') {
  await page.goto(`/read/${decade}s.html#comments`)
  await page.locator('#comments').scrollIntoViewIfNeeded()
  await expect(
    page.getByRole('heading', { name: `${decade}년대 기억 보태기`, exact: true })
  ).toBeVisible()
  await expect(page.locator('.comment-composer')).toBeVisible()
  await expect(page.locator('.comments-status')).toHaveCount(0)
}

async function showComments(page: Page) {
  await page.locator('#comments').scrollIntoViewIfNeeded()
  await expect(page.locator('.comment-composer')).toBeVisible()
  await expect(page.locator('.comments-status')).toHaveCount(0)
}

async function storedComments(request: APIRequestContext, pageId = 'life-1930s') {
  const response = await request.get(commentsFor(pageId), {
    headers: { Authorization: 'Bearer owner' },
  })
  expect(response.ok()).toBeTruthy()
  return ((await response.json()).documents ?? []) as Array<{
    name: string
    fields: Record<string, { stringValue?: string; timestampValue?: string; nullValue?: null }>
  }>
}

async function postMemory(page: Page, author: string, body: string) {
  await page.getByLabel(/^이름/).fill(author)
  await page.getByLabel('내용', { exact: true }).fill(body)
  await page
    .locator('.comment-composer')
    .getByRole('button', { name: '남기기', exact: true })
    .click()
  const comment = page.getByRole('article', { name: `${author} 님의 댓글`, exact: true })
  await expect(comment.locator('.comment-body')).toHaveText(body)
  return comment
}

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

test('a mobile visitor posts without signing in; another browser reads the stored comment and replies', async ({
  page,
  browser,
  request,
}) => {
  const original = '독정리로 이사하던 날 비가 많이 왔어요.\n이삿짐을 함께 옮겼던 기억이 나요.'
  await openComments(page)
  await expect(page.locator('.comment-item')).toHaveCount(0)
  await page.getByLabel(/^이름/).fill('큰딸')
  await page.getByLabel('내용', { exact: true }).fill(original)
  await page
    .locator('.comment-composer')
    .getByRole('button', { name: '남기기', exact: true })
    .click()
  await expect(
    page.getByRole('article', { name: '큰딸 님의 댓글' }).locator('.comment-body')
  ).toHaveText(original)
  await expect(page.locator('.announcement')).toContainText('남겼어요.')
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue('')
  await expect(page.locator('.comment-composer button[type="submit"]')).toBeDisabled()

  const originalDocs = await storedComments(request)
  expect(originalDocs).toHaveLength(1)
  expect(originalDocs[0].fields.body.stringValue).toBe(original)
  expect(originalDocs[0].fields.createdAt.timestampValue).toBeTruthy()
  expect(originalDocs[0].fields.uid.stringValue).toBeTruthy()
  const originalId = originalDocs[0].name.split('/').at(-1)

  const familyContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    reducedMotion: 'reduce',
    baseURL: 'http://127.0.0.1:4175',
  })
  try {
    const familyPage = await familyContext.newPage()
    await openComments(familyPage)
    await expect(
      familyPage.getByRole('article', { name: '큰딸 님의 댓글' }).locator('.comment-body')
    ).toHaveText(original)
    await expect(familyPage.getByLabel(/^이름/)).toHaveValue('')
    await familyPage.getByRole('button', { name: '큰딸 님에게 답글', exact: true }).click()
    await familyPage.getByLabel(/^이름/).fill('막내')
    await familyPage
      .getByLabel('답글', { exact: true })
      .fill('맞아요. 저도 우산을 들고 마중 나갔어요.')
    await familyPage.getByRole('button', { name: '남기기', exact: true }).click()
    const reply = familyPage.getByRole('article', { name: '막내 님의 답글' })
    await expect(reply.locator('.comment-body')).toHaveText(
      '맞아요. 저도 우산을 들고 마중 나갔어요.'
    )
    await expect(reply.locator('.parent-context')).toContainText('큰딸 님에게 답글')
    await expect(reply.getByRole('button', { name: /답글/ })).toHaveCount(0)

    const saved = await storedComments(request)
    expect(saved).toHaveLength(2)
    const savedReply = saved.find((comment) => comment.fields.author.stringValue === '막내')!
    expect(savedReply.fields.parentId.stringValue).toBe(originalId)
    expect(savedReply.fields.uid.stringValue).not.toBe(originalDocs[0].fields.uid.stringValue)

    await page.reload()
    await page.locator('#comments').scrollIntoViewIfNeeded()
    await expect(page.getByRole('article', { name: '막내 님의 답글' })).toBeVisible()
    await expect(page.getByLabel(/^이름/)).toHaveValue('큰딸')
  } finally {
    await familyContext.close()
  }
})

test('names survive reloads, drafts stay with their article, and posted comments do not leak into another article', async ({
  page,
  browser,
  request,
}) => {
  const draft = '1930년대 이야기는 큰아버지께 확인하고 싶어요.'
  const published = '1940년대에는 갯벌에서 자주 놀았다고 들었어요.'
  await openComments(page)
  await page.getByLabel(/^이름/).fill('큰아들')
  await page.getByLabel('내용', { exact: true }).fill(draft)
  await page.reload()
  await page.locator('#comments').scrollIntoViewIfNeeded()
  await expect(page.getByLabel(/^이름/)).toHaveValue('큰아들')
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue(draft)

  await page
    .getByRole('navigation', { name: '앞뒤 이야기' })
    .getByRole('link', { name: /다음 이야기/ })
    .click()
  await expect(page).toHaveURL(/\/read\/1940s\.html$/)
  await showComments(page)
  await expect(
    page.getByRole('heading', { name: '1940년대 기억 보태기', exact: true })
  ).toBeVisible()
  await expect(page.getByLabel(/^이름/)).toHaveValue('큰아들')
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue('')
  await page.getByLabel('내용', { exact: true }).fill(published)
  await page
    .locator('.comment-composer')
    .getByRole('button', { name: '남기기', exact: true })
    .click()
  await expect(page.locator('.comment-body')).toHaveText(published)

  await page
    .getByRole('navigation', { name: '앞뒤 이야기' })
    .getByRole('link', { name: /이전 이야기/ })
    .click()
  await expect(page).toHaveURL(/\/read\/1930s\.html$/)
  await showComments(page)
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue(draft)
  await expect(page.locator('.comment-item')).toHaveCount(0)
  expect(await storedComments(request, 'life-1930s')).toHaveLength(0)
  expect(await storedComments(request, 'life-1940s')).toHaveLength(1)

  // A second visitor can publish immediately without bypassing the real
  // per-visitor cooldown. Both decades must remain isolated in Firestore.
  const otherContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    reducedMotion: 'reduce',
    baseURL: 'http://127.0.0.1:4175',
  })
  const earlierMemory = '1930년대 중장리 집 이야기를 더 들려주세요.'
  try {
    const otherPage = await otherContext.newPage()
    await openComments(otherPage)
    await expect(otherPage.locator('.comment-item')).toHaveCount(0)
    await otherPage.getByLabel(/^이름/).fill('둘째')
    await otherPage.getByLabel('내용', { exact: true }).fill(earlierMemory)
    await otherPage
      .locator('.comment-composer')
      .getByRole('button', { name: '남기기', exact: true })
      .click()
    await expect(otherPage.locator('.comment-body')).toHaveText(earlierMemory)
    await openComments(otherPage, '1940')
    await expect(otherPage.locator('.comment-body')).toHaveText(published)
    await expect(otherPage.getByText(earlierMemory, { exact: true })).toHaveCount(0)

    await page.reload()
    await showComments(page)
    await expect(
      page.getByRole('heading', { name: '1930년대 기억 보태기', exact: true })
    ).toBeVisible()
    await expect(page.locator('.comment-body')).toHaveText(earlierMemory)
    await expect(page.getByText(published, { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('내용', { exact: true })).toHaveValue(draft)

    const earlierComments = await storedComments(request, 'life-1930s')
    const laterComments = await storedComments(request, 'life-1940s')
    expect(earlierComments).toHaveLength(1)
    expect(laterComments).toHaveLength(1)
    expect(earlierComments[0].fields.body.stringValue).toBe(earlierMemory)
    expect(laterComments[0].fields.body.stringValue).toBe(published)
    expect(earlierComments[0].fields.uid.stringValue).not.toBe(
      laterComments[0].fields.uid.stringValue
    )
  } finally {
    await otherContext.close()
  }
})

test('the full story links each decade to its own comments and has no combined thread', async ({
  page,
  request,
}) => {
  await page.goto('/read/life-story.html')
  await expect(page.locator('#comments, .comment-composer')).toHaveCount(0)
  const decadeLinks = page.getByRole('link', { name: /^\d{4}년대 기억 보태기$/ })
  await expect(decadeLinks).toHaveCount(sourceDecades.length)
  for (const decade of sourceDecades) {
    await expect(
      page.getByRole('link', { name: `${decade}년대 기억 보태기`, exact: true })
    ).toHaveAttribute('href', `/read/${decade}s.html#comments`)
  }

  const commentLink = page.getByRole('link', { name: '1930년대 기억 보태기', exact: true })
  await commentLink.click()
  await expect(page).toHaveURL(/\/read\/1930s\.html#comments$/)
  await showComments(page)
  await expect(
    page.getByRole('heading', { name: '1930년대 기억 보태기', exact: true })
  ).toBeVisible()
  const memory = '전체 이야기를 읽다가 중장리 기억을 남겨요.'
  await page.getByLabel(/^이름/).fill('큰딸')
  await page.getByLabel('내용', { exact: true }).fill(memory)
  await page
    .locator('.comment-composer')
    .getByRole('button', { name: '남기기', exact: true })
    .click()
  await expect(page.locator('.comment-body')).toHaveText(memory)

  await page.goto('/read/life-story.html')
  await expect(page.locator('#comments, .comment-composer')).toHaveCount(0)
  await page.getByRole('link', { name: '1930년대 기억 보태기', exact: true }).click()
  await showComments(page)
  await expect(page.locator('.comment-body')).toHaveText(memory)
  const saved = await storedComments(request, 'life-1930s')
  expect(saved).toHaveLength(1)
  expect(saved[0].fields.body.stringValue).toBe(memory)
  expect(await storedComments(request, 'life-story')).toHaveLength(0)
})

test('empty fields are explained and HTML in a posted name or comment is displayed as plain text', async ({
  page,
  request,
}) => {
  await openComments(page)
  await page
    .locator('.comment-composer')
    .getByRole('button', { name: '남기기', exact: true })
    .click()
  await expect(page.getByText('이름을 적어 주세요.', { exact: true })).toBeVisible()
  await expect(page.getByText('내용을 적어 주세요.', { exact: true })).toBeVisible()
  await expect(page.getByLabel(/^이름/)).toBeFocused()
  expect(await storedComments(request)).toHaveLength(0)

  const untrustedName = '<b>엄마</b>'
  const untrustedBody =
    '<img src=x onerror="window.commentInjected=true"><script>window.commentInjected=true</script>\n이 글자는 그대로 보여야 해요.'
  await page.getByLabel(/^이름/).fill(untrustedName)
  await page.getByLabel('내용', { exact: true }).fill(untrustedBody)
  await page
    .locator('.comment-composer')
    .getByRole('button', { name: '남기기', exact: true })
    .click()
  await expect(page.locator('.comment-body')).toHaveText(untrustedBody)
  await expect(page.locator('.comment-meta strong')).toHaveText(untrustedName)
  await expect(
    page.locator('.comment-list img, .comment-list script, .comment-list b')
  ).toHaveCount(0)
  expect(await page.evaluate(() => Reflect.get(window, 'commentInjected'))).toBeUndefined()
  const saved = await storedComments(request)
  expect(saved[0].fields.body.stringValue).toBe(untrustedBody)
})

test('older comments load in bounded pages without duplicate entries', async ({
  page,
  request,
}) => {
  await Promise.all(
    Array.from({ length: 31 }, async (_, index) => {
      const response = await request.patch(`${commentsFor('life-1930s')}/seed-${index}`, {
        headers: { Authorization: 'Bearer owner' },
        data: {
          fields: {
            author: { stringValue: '가족' },
            body: { stringValue: `기억 ${index + 1}` },
            parentId: { nullValue: null },
            uid: { stringValue: 'local-emulator-fixture' },
            createdAt: { timestampValue: new Date(Date.UTC(2020, 0, 1, 0, index)).toISOString() },
          },
        },
      })
      expect(response.ok()).toBeTruthy()
    })
  )
  await openComments(page)
  await expect(page.locator('.comment-item')).toHaveCount(30)
  await expect(page.locator('.comment-body').first()).toHaveText('기억 31')
  await expect(page.locator('.comment-body').last()).toHaveText('기억 2')
  await page.getByRole('button', { name: '댓글 더 보기', exact: true }).click()
  await expect(page.locator('.comment-item')).toHaveCount(31)
  await expect(page.locator('.comment-body').last()).toHaveText('기억 1')
  await expect(page.getByRole('button', { name: '댓글 더 보기', exact: true })).toHaveCount(0)
  const ids = await page
    .locator('.comment-item')
    .evaluateAll((items) => items.map((item) => item.id))
  expect(new Set(ids).size).toBe(31)
})

test('the original browser can cancel and save an edit without changing the new-comment draft or ownership', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const original = '이사한 해는 1938년으로 기억해요.'
  const revised = '이사한 해는 1939년이었어요.\n집안 기록을 다시 확인했어요.'
  const separateDraft = '다음에는 옛집 이야기도 남기고 싶어요.'
  await openComments(page)
  const comment = await postMemory(page, '큰딸', original)
  const [before] = await storedComments(request)
  await page.getByLabel('내용', { exact: true }).fill(separateDraft)

  await comment.getByRole('button', { name: '수정', exact: true }).click()
  const editor = comment.getByRole('textbox', { name: '댓글 수정', exact: true })
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue(original)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/comments/mobile-edit-320.png' })
  await editor.fill('취소할 내용이에요.')
  await comment.getByRole('button', { name: '취소', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(comment.locator('.comment-body')).toHaveText(original)
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue(separateDraft)
  expect((await storedComments(request))[0].fields).toEqual(before.fields)

  await comment.getByRole('button', { name: '수정', exact: true }).click()
  await editor.fill(revised)
  await comment.getByRole('button', { name: '저장', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expect(comment.locator('.comment-body')).toHaveText(revised)
  await expect(comment.locator('.comment-edited')).toHaveText('(수정됨)')
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue(separateDraft)

  const [after] = await storedComments(request)
  expect(after.name).toBe(before.name)
  expect(after.fields).toEqual({
    ...before.fields,
    body: { stringValue: revised },
    updatedAt: { timestampValue: expect.any(String) },
  })
  expect(Date.parse(after.fields.updatedAt.timestampValue!)).toBeGreaterThanOrEqual(
    Date.parse(before.fields.createdAt.timestampValue!)
  )

  await page.reload()
  await showComments(page)
  await expect(comment.locator('.comment-body')).toHaveText(revised)
  await expect(comment.getByRole('button', { name: '수정', exact: true })).toBeVisible()
  await expect(comment.getByRole('button', { name: '삭제', exact: true })).toBeVisible()
  await expect(page.getByLabel('내용', { exact: true })).toHaveValue(separateDraft)
})

test('a different browser cannot manage someone else’s comment even when it uses the same name', async ({
  page,
  browser,
}) => {
  await openComments(page)
  const comment = await postMemory(page, '큰딸', '큰아버지께 들은 기억이에요.')
  await expect(comment.getByRole('button', { name: '수정', exact: true })).toBeVisible()
  await expect(comment.getByRole('button', { name: '삭제', exact: true })).toBeVisible()

  const otherContext = await mobileFamilyContext(browser)
  try {
    const otherPage = await otherContext.newPage()
    await openComments(otherPage)
    const othersComment = otherPage.getByRole('article', { name: '큰딸 님의 댓글', exact: true })
    await expect(othersComment.locator('.comment-body')).toHaveText('큰아버지께 들은 기억이에요.')
    await expect(othersComment.getByRole('button', { name: '수정', exact: true })).toHaveCount(0)
    await expect(othersComment.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0)
    await otherPage.getByLabel(/^이름/).fill('큰딸')
    await otherPage.reload()
    await showComments(otherPage)
    await expect(otherPage.getByLabel(/^이름/)).toHaveValue('큰딸')
    await expect(othersComment.getByRole('button', { name: '수정', exact: true })).toHaveCount(0)
    await expect(othersComment.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0)
  } finally {
    await otherContext.close()
  }
})

test('deleting a comment requires confirmation and stays deleted after reload', async ({
  page,
  request,
}) => {
  await openComments(page)
  const comment = await postMemory(page, '큰아들', '잘못 남긴 기억이라 지울 예정이에요.')
  const [before] = await storedComments(request)

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    await dialog.dismiss()
  })
  await comment.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(comment).toBeVisible()
  expect((await storedComments(request))[0].fields).toEqual(before.fields)

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    await dialog.accept()
  })
  await comment.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(comment).toHaveCount(0)
  expect(await storedComments(request)).toHaveLength(0)
  await page.reload()
  await showComments(page)
  await expect(page.locator('.comment-item')).toHaveCount(0)
})

test('deleting a parent keeps another family member’s reply editable by its original author', async ({
  page,
  browser,
  request,
}) => {
  await openComments(page)
  const parent = await postMemory(page, '큰딸', '옛집에 감나무가 있었지요.')
  const [storedParent] = await storedComments(request)
  const otherContext = await mobileFamilyContext(browser)
  try {
    const otherPage = await otherContext.newPage()
    await openComments(otherPage)
    await otherPage.getByRole('button', { name: '큰딸 님에게 답글', exact: true }).click()
    await otherPage.getByLabel(/^이름/).fill('막내')
    await otherPage.getByLabel('답글', { exact: true }).fill('마당 한가운데 큰 감나무가 있었어요.')
    await otherPage.getByRole('button', { name: '남기기', exact: true }).click()
    const reply = otherPage.getByRole('article', { name: '막내 님의 답글', exact: true })
    await expect(reply.locator('.comment-body')).toHaveText('마당 한가운데 큰 감나무가 있었어요.')
    const storedReply = (await storedComments(request)).find(
      (item) => item.fields.author.stringValue === '막내'
    )!

    await page.reload()
    await showComments(page)
    const othersReply = page.getByRole('article', { name: '막내 님의 답글', exact: true })
    await expect(othersReply.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0)
    page.once('dialog', (dialog) => dialog.accept())
    await parent.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(parent).toHaveCount(0)
    await expect(othersReply.locator('.comment-body')).toHaveText(
      '마당 한가운데 큰 감나무가 있었어요.'
    )
    const remaining = await storedComments(request)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].name).toBe(storedReply.name)
    expect(remaining[0].fields).toEqual(storedReply.fields)
    expect(remaining[0].fields.parentId.stringValue).toBe(storedParent.name.split('/').at(-1))

    await otherPage.reload()
    await showComments(otherPage)
    await expect(
      otherPage.getByRole('article', { name: '큰딸 님의 댓글', exact: true })
    ).toHaveCount(0)
    await reply.getByRole('button', { name: '수정', exact: true }).click()
    await reply
      .getByRole('textbox', { name: '댓글 수정', exact: true })
      .fill('감나무는 마당 오른쪽에 있었어요.')
    await reply.getByRole('button', { name: '저장', exact: true }).click()
    await expect(reply.locator('.comment-body')).toHaveText('감나무는 마당 오른쪽에 있었어요.')
    const [editedReply] = await storedComments(request)
    expect(editedReply.fields).toEqual({
      ...storedReply.fields,
      body: { stringValue: '감나무는 마당 오른쪽에 있었어요.' },
      updatedAt: { timestampValue: expect.any(String) },
    })
  } finally {
    await otherContext.close()
  }
})

test('an existing anonymous session recovers ownership of old comments without an updatedAt field', async ({
  page,
  request,
}) => {
  await openComments(page)
  await postMemory(page, '큰딸', '이 기기의 익명 방문자 기록이에요.')
  const [sessionComment] = await storedComments(request)
  const legacyFields = {
    author: { stringValue: '예전에 남긴 이름' },
    body: { stringValue: '예전에 이 기기에서 남긴 기억이에요.' },
    parentId: { nullValue: null },
    uid: sessionComment.fields.uid,
    createdAt: { timestampValue: '2020-01-01T00:00:00Z' },
  }
  const seed = await request.patch(`${commentsFor('life-1930s')}/legacy-own`, {
    headers: { Authorization: 'Bearer owner' },
    data: { fields: legacyFields },
  })
  expect(seed.ok()).toBeTruthy()

  await page.reload()
  await showComments(page)
  const legacy = page.getByRole('article', { name: '예전에 남긴 이름 님의 댓글', exact: true })
  await expect(legacy.locator('.comment-edited')).toHaveCount(0)
  await expect(legacy.getByRole('button', { name: '삭제', exact: true })).toBeVisible()
  await legacy.getByRole('button', { name: '수정', exact: true }).click()
  await legacy
    .getByRole('textbox', { name: '댓글 수정', exact: true })
    .fill('예전 기억을 다시 확인해서 고쳤어요.')
  await legacy.getByRole('button', { name: '저장', exact: true }).click()
  await expect(legacy.locator('.comment-body')).toHaveText('예전 기억을 다시 확인해서 고쳤어요.')
  const saved = (await storedComments(request)).find((item) => item.name.endsWith('/legacy-own'))!
  expect(saved.fields).toEqual({
    ...legacyFields,
    body: { stringValue: '예전 기억을 다시 확인해서 고쳤어요.' },
    updatedAt: { timestampValue: expect.any(String) },
  })
  await page.reload()
  await showComments(page)
  await expect(legacy.locator('.comment-body')).toHaveText('예전 기억을 다시 확인해서 고쳤어요.')
  await expect(legacy.getByRole('button', { name: '수정', exact: true })).toBeVisible()
})

test('a rejected edit keeps the edited text and leaves the stored body unchanged', async ({
  page,
  request,
}) => {
  await openComments(page)
  const original = '원래 남겼던 기억이에요.'
  const unsaved = '연결 문제가 있어도 이 수정 내용은 사라지면 안 돼요.'
  const comment = await postMemory(page, '큰딸', original)
  const [saved] = await storedComments(request)
  await comment.getByRole('button', { name: '수정', exact: true }).click()
  const editor = comment.getByRole('textbox', { name: '댓글 수정', exact: true })
  await editor.fill('   ')
  await comment.getByRole('button', { name: '저장', exact: true }).click()
  await expect(comment.getByRole('alert')).toHaveText('내용을 적어 주세요.')
  await expect(editor).toHaveValue('   ')
  expect((await storedComments(request))[0].fields.body.stringValue).toBe(original)
  await editor.fill(unsaved)

  // Simulate stale ownership on the local demo server, after the editor opens.
  // A failed authorization must neither discard the draft nor change the body.
  const reassigned = await request.patch(
    `${FIRESTORE}/v1/${saved.name}?updateMask.fieldPaths=uid`,
    {
      headers: { Authorization: 'Bearer owner' },
      data: { fields: { uid: { stringValue: 'another-emulator-user' } } },
    }
  )
  expect(reassigned.ok()).toBeTruthy()
  await comment.getByRole('button', { name: '저장', exact: true }).click()
  await expect(comment.getByRole('alert')).toBeVisible()
  await expect(editor).toHaveValue(unsaved)
  await expect(comment.getByRole('button', { name: '저장', exact: true })).toBeEnabled()
  expect((await storedComments(request))[0].fields.body.stringValue).toBe(original)
})
