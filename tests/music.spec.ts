import { expect, test, type Page } from '@playwright/test'
import rawCatalog from '../site/.vitepress/generated/catalog.json' with { type: 'json' }

async function playing(page: Page, src: string) {
  await expect(page.locator('.background-audio')).toHaveAttribute('src', `/bae-memoir${src}`)
  await expect.poll(() => page.locator('.background-audio').evaluate((audio: HTMLAudioElement) =>
    !audio.paused && audio.readyState >= 2 && Number.isFinite(audio.duration) && audio.duration > 0)).toBe(true)
  await expect(page.getByRole('button', { name: '음악 일시정지', exact: true })).toHaveAttribute('aria-pressed', 'true')
}

async function startMusic(page: Page, src: string) {
  await expect.poll(() => page.evaluate(() => {
    const audio = document.querySelector<HTMLAudioElement>('.background-audio')
    return Boolean(audio && !audio.paused && audio.readyState >= 2) ||
      document.querySelector('.music-toggle')?.getAttribute('aria-label') === '음악 재생'
  })).toBe(true)
  if (await page.getByRole('button', { name: '음악 재생', exact: true }).isVisible())
    await page.getByRole('button', { name: '음악 재생', exact: true }).click()
  await playing(page, src)
}

async function iconOnly(page: Page) {
  await expect(page.locator('.music-toggle')).toHaveCount(1)
  await expect(page.locator('.music-toggle')).toHaveText('')
  await expect(page.locator('.music-toggle svg')).toHaveCount(1)
  await expect(page.locator('.music-controls, .music-track, .music-volume, .music-message')).toHaveCount(0)
  await expect(page.getByRole('slider')).toHaveCount(0)
}

async function fixedVolume(page: Page) {
  expect(await page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => audio.volume)).toBe(0.1)
}

test('음악은 기본 재생하고 아이콘 하나만 표시하며 첫 읽기 조작으로 자동재생 제한을 해제한다', async ({ page }, info) => {
  await page.addInitScript(() => {
    const originalPlay = HTMLMediaElement.prototype.play
    let first = true
    HTMLMediaElement.prototype.play = function () {
      if (first) { first = false; return Promise.reject(new DOMException('Gesture required', 'NotAllowedError')) }
      return originalPlay.call(this)
    }
  })
  await page.goto('./')
  await iconOnly(page)
  await fixedVolume(page)
  await expect(page.locator('.background-audio')).toHaveAttribute('src', '/bae-memoir/music/home.mp3')
  await expect(page.getByRole('button', { name: '음악 재생', exact: true })).toBeVisible()
  await page.locator('.resume-link').click()
  await playing(page, '/music/prologue.mp3')
  await iconOnly(page)
  await fixedVolume(page)
  await expect(page.locator('.reader-actions .music-toggle')).toHaveCount(1)
  const icon = (await page.locator('.music-toggle').boundingBox())!
  expect(icon.width).toBe(44)
  expect(icon.height).toBe(44)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('.reader-toolbar').screenshot({ path: `test-results/reading/${info.project.name}-music-icon.png` })
})

test('일시정지한 위치를 이어 재생하고 이전 음량 설정을 무시하며 일시정지 선택을 기억한다', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('family-library:music'))
      localStorage.setItem('family-library:music', JSON.stringify({ enabled: false, volume: 1 }))
  })
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/music/')) requests.push(request.url()) })
  await page.goto('./')
  await expect(page.getByRole('button', { name: '음악 재생', exact: true })).toBeVisible()
  await expect(page.locator('.background-audio')).not.toHaveAttribute('src')
  await fixedVolume(page)
  expect(requests).toEqual([])
  await page.getByRole('button', { name: '음악 재생', exact: true }).click()
  await playing(page, '/music/home.mp3')
  await page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => { audio.currentTime = 12 })
  await page.getByRole('button', { name: '음악 일시정지', exact: true }).click()
  const pausedAt = await page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)
  expect(pausedAt).toBeGreaterThanOrEqual(12)
  expect(await page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  await expect(page.locator('.background-audio')).toHaveAttribute('src', '/bae-memoir/music/home.mp3')
  await page.getByRole('button', { name: '음악 재생', exact: true }).click()
  await playing(page, '/music/home.mp3')
  const resumedAt = await page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)
  expect(resumedAt).toBeGreaterThanOrEqual(pausedAt)
  expect(resumedAt - pausedAt).toBeLessThan(1)
  await fixedVolume(page)
  await page.getByRole('button', { name: '음악 일시정지', exact: true }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('family-library:music') || '{}'))).toEqual({ enabled: false })
  await page.locator('.resume-link').click()
  await expect(page.locator('.background-audio')).not.toHaveAttribute('src')
  await page.reload()
  await expect(page.getByRole('button', { name: '음악 재생', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '음악 재생', exact: true }).click()
  await playing(page, '/music/prologue.mp3')
  await fixedVolume(page)
})

test('하나의 재생기로 홈과 모든 회차의 27곡을 10% 음량으로 재생하며 이동한다', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const broken: string[] = []
  page.on('response', response => { if (response.url().includes('/music/') && !response.ok()) broken.push(response.url()) })
  await page.goto('./')
  const audio = (await page.locator('.background-audio').elementHandle())!
  await startMusic(page, rawCatalog.music!.home.src)
  await page.locator('.resume-link').click()
  for (const episode of rawCatalog.readingOrder) {
    await expect(page).toHaveURL(new RegExp(`${episode.url}$`))
    const track = rawCatalog.music!.episodes[episode.episodeId as keyof typeof rawCatalog.music.episodes]
    await iconOnly(page)
    await playing(page, track.src)
    await fixedVolume(page)
    expect(await audio.evaluate(element => element === document.querySelector('.background-audio'))).toBe(true)
    await page.locator('.next-episode').click()
  }
  await playing(page, rawCatalog.music!.home.src)
  expect(broken).toEqual([])
  expect(errors).toEqual([])
})

test('재생 아이콘을 키보드로 조작하고 저장된 음량과 무관하게 10%로 시작한다', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('family-library:music', JSON.stringify({ enabled: true, volume: 0.8 }))
    const originalPlay = HTMLMediaElement.prototype.play
    let first = true
    HTMLMediaElement.prototype.play = function () {
      if (first) { first = false; return Promise.reject(new DOMException('Gesture required', 'NotAllowedError')) }
      return originalPlay.call(this)
    }
  })
  await page.goto('read/josae.html')
  const play = page.getByRole('button', { name: '음악 재생', exact: true })
  await expect(play).toHaveAttribute('aria-pressed', 'false')
  await play.focus()
  await page.keyboard.press('Enter')
  await playing(page, '/music/josae.mp3')
  await fixedVolume(page)
  await page.keyboard.press('Enter')
  await expect(play).toHaveAttribute('aria-pressed', 'false')
  expect(await page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
})

test('음악 요청이 실패해도 본문을 읽고 재생 아이콘으로 다시 시작할 수 있다', async ({ page }) => {
  await page.route('**/music/home.mp3', route => route.abort())
  await page.goto('./')
  await expect(page.getByRole('button', { name: '음악 재생', exact: true })).toBeVisible()
  if (!await page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => Boolean(audio.error)))
    await page.getByRole('button', { name: '음악 재생', exact: true }).click()
  await expect.poll(() => page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => Boolean(audio.error))).toBe(true)
  await expect(page.locator('.chapter-row')).toHaveCount(26)
  await expect(page.getByRole('button', { name: '음악 재생', exact: true })).toBeVisible()
  await page.unroute('**/music/home.mp3')
  await page.getByRole('button', { name: '음악 재생', exact: true }).click()
  await playing(page, '/music/home.mp3')
  await fixedVolume(page)
})

test('기기의 기본 음량이 고정되어 있어도 10%로 재생하고 일시정지한다', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', { get: () => 1, set() {}, configurable: true })
    const original = AudioContext.prototype.createGain
    AudioContext.prototype.createGain = function () {
      const gain = original.call(this)
      Object.assign(window, { musicGain: gain, musicContext: this })
      return gain
    }
  })
  const gainValue = () => page.evaluate(() => (window as typeof window & { musicGain: GainNode }).musicGain.gain.value)
  await page.goto('./')
  await startMusic(page, '/music/home.mp3')
  await expect.poll(gainValue).toBeCloseTo(0.1, 3)
  await page.locator('.resume-link').click()
  await playing(page, '/music/prologue.mp3')
  await expect.poll(gainValue).toBeCloseTo(0.1, 3)
  await page.getByRole('button', { name: '음악 일시정지', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as typeof window & { musicContext: AudioContext }).musicContext.state)).toBe('suspended')
  await page.getByRole('button', { name: '음악 재생', exact: true }).click()
  await playing(page, '/music/prologue.mp3')
  await expect.poll(gainValue).toBeCloseTo(0.1, 3)
})
