import { expect, test, type Page } from '@playwright/test'
import rawCatalog from '../site/.vitepress/generated/catalog.json' with { type: 'json' }

async function playing(page: Page, src: string) {
  await expect(page.locator('.background-audio')).toHaveAttribute('src', `/bae-memoir${src}`)
  await expect.poll(() => page.locator('.background-audio').evaluate((audio: HTMLAudioElement) =>
    !audio.paused && audio.readyState >= 2 && Number.isFinite(audio.duration) && audio.duration > 0)).toBe(true)
  await expect(page.getByRole('button', { name: '음악 끄기', exact: true })).toHaveAttribute('aria-pressed', 'true')
}

async function startMusic(page: Page, src: string) {
  // A browser may allow initial autoplay or require a gesture first.
  await expect.poll(() => page.locator('.background-audio').evaluate((audio: HTMLAudioElement) =>
    !audio.paused || Boolean(document.querySelector('.music-message')))).toBe(true)
  if (await page.getByRole('button', { name: '음악 켜기', exact: true }).isVisible())
    await page.getByRole('button', { name: '음악 켜기', exact: true }).click()
  await playing(page, src)
}

test('첫 방문부터 음악이 켜져 있고 자동재생이 차단되면 첫 읽기 조작으로 재생한다', async ({ page }) => {
  await page.addInitScript(() => {
    const originalPlay = HTMLMediaElement.prototype.play
    let first = true
    HTMLMediaElement.prototype.play = function () {
      if (first) { first = false; return Promise.reject(new DOMException('Gesture required', 'NotAllowedError')) }
      return originalPlay.call(this)
    }
  })
  await page.goto('./')
  await expect(page.locator('.background-audio')).toHaveAttribute('src', '/bae-memoir/music/home.mp3')
  await expect(page.getByRole('slider', { name: '음악 음량' })).toHaveValue('0.3')
  await expect(page.getByRole('status')).toHaveText('화면을 누르면 음악이 재생됩니다.')
  await page.locator('.resume-link').click()
  await playing(page, '/music/prologue.mp3')
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('사용자가 끈 음악은 다시 방문해도 꺼져 있고 켜기·끄기·음량 설정을 기억한다', async ({ page }, info) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('family-library:music'))
      localStorage.setItem('family-library:music', JSON.stringify({ enabled: false, volume: 0.3 }))
  })
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/music/')) requests.push(request.url()) })
  await page.goto('./')
  await expect(page.locator('.music-track')).toHaveText('작품 소개 음악')
  await expect(page.getByRole('button', { name: '음악 켜기', exact: true })).toBeVisible()
  await expect(page.locator('.background-audio')).not.toHaveAttribute('src')
  await page.locator('.resume-link').click()
  await expect(page.locator('.music-track')).toHaveText('프롤로그 음악')
  await expect(page.locator('.background-audio')).not.toHaveAttribute('src')
  expect(requests).toEqual([])

  await page.getByRole('button', { name: '음악 켜기', exact: true }).click()
  await playing(page, '/music/prologue.mp3')
  await expect(page.locator('.background-audio')).toHaveAttribute('loop', '')
  await expect(page.locator('.background-audio')).toHaveAttribute('preload', 'none')
  const volume = page.getByRole('slider', { name: '음악 음량' })
  await volume.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  await expect(volume).toHaveValue('0.55')
  expect(await page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => audio.volume)).toBe(0.55)
  await page.locator('.music-controls').screenshot({ path: `test-results/reading/${info.project.name}-music-controls.png` })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.locator('.next-episode').click()
  await playing(page, '/music/josae.mp3')
  await expect(volume).toHaveValue('0.55')
  await page.getByRole('button', { name: '음악 끄기', exact: true }).click()
  await expect(page.locator('.background-audio')).not.toHaveAttribute('src')
  expect(await page.locator('.background-audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('family-library:music') || '{}')))
    .toEqual({ enabled: false, volume: 0.55 })
  await page.reload()
  await expect(page.getByRole('button', { name: '음악 켜기', exact: true })).toBeVisible()
  await expect(page.locator('.background-audio')).not.toHaveAttribute('src')
  await page.getByRole('button', { name: '음악 켜기', exact: true }).click()
  await playing(page, '/music/josae.mp3')
  await expect(volume).toHaveValue('0.55')
})

test('하나의 재생기로 홈과 모든 회차의 27곡을 실제 재생하며 이동한다', async ({ page }) => {
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
    await expect(page.locator('.music-track')).toHaveText(track.label)
    await playing(page, track.src)
    expect(await audio.evaluate(element => element === document.querySelector('.background-audio'))).toBe(true)
    await page.locator('.next-episode').click()
  }
  await playing(page, rawCatalog.music!.home.src)
  expect(broken).toEqual([])
  expect(errors).toEqual([])
})

test('저장된 켜기 설정의 자동재생이 차단되면 클릭으로 재생을 시작한다', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('family-library:music', JSON.stringify({ enabled: true, volume: 0.2 }))
    const originalPlay = HTMLMediaElement.prototype.play
    let first = true
    HTMLMediaElement.prototype.play = function () {
      if (first) { first = false; return Promise.reject(new DOMException('Gesture required', 'NotAllowedError')) }
      return originalPlay.call(this)
    }
  })
  await page.goto('read/josae.html')
  await expect(page.getByRole('status')).toHaveText('화면을 누르면 음악이 재생됩니다.')
  await expect(page.getByRole('button', { name: '음악 켜기', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: '음악 켜기', exact: true }).click()
  await playing(page, '/music/josae.mp3')
  await expect(page.getByRole('slider', { name: '음악 음량' })).toHaveValue('0.2')
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('음악 요청이 실패해도 읽기를 유지하고 다시 재생할 수 있다', async ({ page }) => {
  await page.route('**/music/home.mp3', route => route.abort())
  await page.goto('./')
  // Autoplay policy may stop the initial attempt before the network failure is reported.
  await expect(page.getByRole('status')).toBeVisible()
  if (await page.getByRole('status').innerText() === '화면을 누르면 음악이 재생됩니다.')
    await page.getByRole('button', { name: '음악 켜기', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('음악을 불러오지 못했습니다.')
  await expect(page.locator('.chapter-row')).toHaveCount(26)
  await page.unroute('**/music/home.mp3')
  await page.getByRole('button', { name: '음악 켜기', exact: true }).click()
  await playing(page, '/music/home.mp3')
})

test('기기의 기본 음량이 고정되어 있어도 음악의 음량과 음소거가 작동한다', async ({ page }) => {
  await page.addInitScript(() => {
    // Model mobile Safari's read-only media volume while using a real Web Audio graph.
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
  await expect.poll(gainValue).toBeCloseTo(0.3, 3)
  expect(await page.evaluate(() => (window as typeof window & { musicContext: AudioContext }).musicContext.state)).toBe('running')
  await page.getByRole('slider', { name: '음악 음량' }).focus()
  await page.keyboard.press('Home')
  await expect.poll(gainValue).toBeCloseTo(0, 3)
  await page.keyboard.press('End')
  await expect.poll(gainValue).toBeCloseTo(1, 3)
  await page.locator('.resume-link').click()
  await playing(page, '/music/prologue.mp3')
  await expect.poll(gainValue).toBeCloseTo(1, 3)
  await page.getByRole('button', { name: '음악 끄기', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as typeof window & { musicContext: AudioContext }).musicContext.state)).toBe('suspended')
  await page.getByRole('button', { name: '음악 켜기', exact: true }).click()
  await playing(page, '/music/prologue.mp3')
})
