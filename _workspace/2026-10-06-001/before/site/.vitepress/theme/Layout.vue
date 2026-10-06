<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Content, useData, useRoute, useRouter, withBase } from 'vitepress'
import Icon from './components/Icon.vue'
import WorkHome from './components/WorkHome.vue'
import EpisodeEnd from './components/EpisodeEnd.vue'
import { catalog, type Episode } from './lib/catalog'
type SavedReading = { id: string; scroll: number; title: string; url: string }
const { frontmatter, page } = useData()
const route = useRoute()
const router = useRouter()
const previousBeforeLoad = router.onBeforePageLoad
const isHome = computed(() => frontmatter.value.layout === 'home')
const isMissing = computed(() => Boolean(page.value.isNotFound))
const pageId = computed(() => String(frontmatter.value.commentId || ''))
const title = computed(() => String(frontmatter.value.title || '이야기'))
const homeHref = computed(() => withBase('/') + (frontmatter.value.episodeId ? `#episode-${frontmatter.value.episodeId}` : ''))
const fontSize = ref(1)
const sizeLabels = ['보통', '크게', '더 크게', '가장 크게']
const screenMode = ref('auto')
const modes = [{ value: 'auto', label: '자동' }, { value: 'light', label: '밝게' }, { value: 'dark', label: '어둡게' }]
const lastRead = ref<SavedReading | null>(null)
const completed = ref<string[]>([])
const settingsDialog = ref<HTMLDialogElement>()
const storageKey = 'family-library:reading'
let activeEpisode: Episode | undefined, activeScroll = 0, version = 0
let saveTimer: ReturnType<typeof setTimeout> | undefined
let mounted = false
function readStorage(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function writeStorage(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* optional */ } }
function saveReading() {
  if (!activeEpisode) return
  const saved = { id: activeEpisode.id, title: activeEpisode.title, url: withBase(activeEpisode.url), scroll: Math.max(0, activeScroll) }
  writeStorage(storageKey, JSON.stringify(saved)); lastRead.value = saved
}
function onScroll() {
  if (!activeEpisode) return
  activeScroll = window.scrollY
  clearTimeout(saveTimer); saveTimer = setTimeout(saveReading, 250)
}
function pagehide() { activeScroll = window.scrollY; saveReading() }
function complete() {
  if (!activeEpisode || completed.value.includes(activeEpisode.id)) return
  completed.value = [...completed.value, activeEpisode.id]
  writeStorage('family-library:completed', JSON.stringify(completed.value))
  saveReading()
}
function resumeReading() { if (lastRead.value) writeStorage('family-library:resume', JSON.stringify(lastRead.value)) }
function setFont(size: number) { fontSize.value = size; writeStorage('family-library:font', String(size)) }
function setMode(mode: string) {
  screenMode.value = mode
  document.documentElement.dataset.theme = mode
  writeStorage('family-library:theme', mode)
}
function closeDialogs() { settingsDialog.value?.close() }
function closeOnBackdrop(event: MouseEvent) {
  const dialog = event.currentTarget as HTMLDialogElement
  if (event.target !== dialog) return
  const rect = dialog.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close()
}
async function setupPage() {
  const current = ++version
  clearTimeout(saveTimer); saveReading(); activeEpisode = undefined
  closeDialogs()
  await nextTick()
  if (current !== version) return
  activeEpisode = catalog.readingOrder.find(e => e.id === pageId.value)
  if (!activeEpisode) return
  activeScroll = 0
  try {
    const saved = JSON.parse(readStorage('family-library:resume') || 'null')
    if (saved?.id === activeEpisode.id && Number.isFinite(saved.scroll)) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (current !== version) return
      window.scrollTo({ top: Math.max(0, saved.scroll), behavior: 'instant' }); activeScroll = window.scrollY
      try { localStorage.removeItem('family-library:resume') } catch { /* optional */ }
    }
  } catch { /* optional */ }
  saveReading()
}
onMounted(() => {
  mounted = true
  router.onBeforePageLoad = async (href) => {
    if (activeEpisode) { activeScroll = window.scrollY; saveReading(); activeEpisode = undefined }
    return await previousBeforeLoad?.(href)
  }
  const preferred = Number(readStorage('family-library:font') ?? 1)
  if ([0, 1, 2, 3].includes(preferred)) fontSize.value = preferred
  const mode = readStorage('family-library:theme')
  setMode(modes.some(m => m.value === mode) ? mode! : 'auto')
  try {
    const read = JSON.parse(readStorage('family-library:completed') || '[]')
    if (Array.isArray(read)) completed.value = read.filter(id => typeof id === 'string' && catalog.readingOrder.some(e => e.id === id))
    const saved = JSON.parse(readStorage(storageKey) || 'null')
    if (saved && typeof saved.id === 'string' && Number.isFinite(saved.scroll)) {
      const id = catalog.legacyIds[saved.id] || saved.id
      const entry = catalog.readingOrder.find(e => e.id === id)
      if (entry) lastRead.value = { id, title: entry.title, url: withBase(entry.url), scroll: id === saved.id ? Math.max(0, saved.scroll) : 0 }
    }
  } catch { /* optional */ }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('pagehide', pagehide)
  void setupPage()
})
watch(() => route.path, () => { if (mounted) void setupPage() })
onBeforeUnmount(() => { router.onBeforePageLoad = previousBeforeLoad; ++version; clearTimeout(saveTimer); saveReading(); window.removeEventListener('scroll', onScroll); window.removeEventListener('pagehide', pagehide) })
</script>
<template>
  <div class="library" :class="`font-${fontSize}`">
    <a class="skip-link" href="#main">본문으로 건너뛰기</a>
    <WorkHome v-if="isHome" :last-id="lastRead?.id || null" :completed="completed" @resume="resumeReading" />
    <main v-else-if="isMissing" id="main" tabindex="-1" class="not-found"><h1>이야기를 찾지 못했습니다.</h1><a class="text-link" :href="withBase('/')">목록으로 돌아가기</a></main>
    <main v-else-if="frontmatter.kind === 'redirect'" id="main" class="not-found"><h1>이야기가 옮겨졌습니다.</h1><Content /><a class="text-link" :href="withBase(frontmatter.redirect)">옮겨진 회차 보기</a></main>
    <template v-else>
      <header class="reader-toolbar"><nav aria-label="읽기 도구"><a class="back-link" :href="homeHref"><Icon name="back" :size="18" /><span>목록</span></a><div class="reader-actions"><button class="font-button" aria-haspopup="dialog" @click="settingsDialog?.showModal()">보기 설정</button></div></nav></header>
      <main id="main" tabindex="-1" class="reader-main">
        <header class="article-header"><p v-if="frontmatter.label || frontmatter.kind === 'full'" class="article-label">{{ frontmatter.partLabel ? `${frontmatter.partLabel} · ` : '' }}{{ frontmatter.label || '전체 이야기' }}</p><h1>{{ title }}</h1><p v-if="frontmatter.time" class="article-time">{{ frontmatter.time }}</p></header>
        <article class="story-content"><Content /></article>
        <EpisodeEnd v-if="pageId" :key="pageId" :page-id="pageId" :title="title" :episode="frontmatter.kind === 'episode'" :prev="frontmatter.prev" :next="frontmatter.next" :home-href="homeHref" @complete="complete" />
      </main>
    </template>
    <dialog ref="settingsDialog" class="reading-settings" aria-labelledby="settings-title" @click="closeOnBackdrop">
      <div class="dialog-body"><header class="dialog-heading"><h2 id="settings-title">보기 설정</h2><button class="close-button" aria-label="보기 설정 닫기" @click="closeDialogs"><Icon name="close" :size="21" /></button></header>
        <p class="settings-label">글자 크기</p><div class="size-options" role="group" aria-label="글자 크기 선택"><button v-for="(label, size) in sizeLabels" :key="size" :class="{ selected: fontSize === size }" :aria-pressed="fontSize === size" @click="setFont(size)">{{ label }}</button></div>
        <p class="settings-label">화면</p><div class="screen-options" role="group" aria-label="화면 모드 선택"><button v-for="mode in modes" :key="mode.value" :class="{ selected: screenMode === mode.value }" :aria-pressed="screenMode === mode.value" @click="setMode(mode.value)">{{ mode.label }}</button></div>
      </div>
    </dialog>
  </div>
</template>
