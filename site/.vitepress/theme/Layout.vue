<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { Content, useData, useRoute, withBase } from 'vitepress'
import Icon from './components/Icon.vue'
import { isCommentsConfigured } from './lib/firebase-config'
import { parseDecadeHeading } from '../shared/decade-heading.mjs'
import rawCatalog from '../generated/catalog.json'

type Reading = { id: string; title: string; url: string }
type Chapter = Reading & { subtitle: string; decade: string }
type SavedReading = Reading & { scroll: number; progress: number }
const catalog = rawCatalog as {
  readingOrder: Chapter[]
  documents: Reading[]
  fullStory: Reading
}
const CommentsSection = defineAsyncComponent(() => import('./components/CommentsSection.vue'))
const commentsEnabled = isCommentsConfigured()
const { frontmatter, page } = useData()
const route = useRoute()
const homeHref = withBase('/')
const isHome = computed(() => frontmatter.value.layout === 'home')
const isMissing = computed(() => Boolean(page.value.isNotFound))
const pageId = computed(() => String(frontmatter.value.commentId || ''))
const title = computed(() => String(frontmatter.value.title || page.value.title || '이야기'))
const decadeHeading = computed(() =>
  frontmatter.value.kind === 'chapter' ? parseDecadeHeading(title.value) : null
)
const displayTitle = computed(() => decadeHeading.value?.subtitle || title.value)
const articleLabel = computed(() =>
  decadeHeading.value?.subtitle
    ? decadeHeading.value.label
    : frontmatter.value.kind === 'full'
      ? '전체 이야기'
      : ''
)
const showComments = computed(
  () => commentsEnabled && Boolean(pageId.value) && frontmatter.value.kind !== 'full'
)
const commentHeading = computed(() =>
  frontmatter.value.decade ? `${frontmatter.value.decade} 기억 보태기` : '기억 보태기'
)
const fontSize = ref(1)
const sizeLabels = ['보통', '크게', '더 크게']
const lastRead = ref<SavedReading | null>(null)
const story = ref<HTMLElement>()
const settingsDialog = ref<HTMLDialogElement>()
const commentsSentinel = ref<HTMLElement>()
const commentsReady = ref(false)
const storageKey = 'family-library:reading'
let commentsObserver: IntersectionObserver | undefined
let scrollFrame = 0
let saveTimer: ReturnType<typeof setTimeout> | undefined
let setupVersion = 0

function readStorage(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Reading also works without local storage. */
  }
}
function openDialog(dialog?: HTMLDialogElement) {
  if (dialog && !dialog.open) dialog.showModal()
}
function closeDialogs() {
  settingsDialog.value?.close()
}
function closeOnBackdrop(event: MouseEvent) {
  const dialog = event.currentTarget as HTMLDialogElement
  if (event.target !== dialog) return
  const bounds = dialog.getBoundingClientRect()
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    dialog.close()
}
function setFont(size: number) {
  fontSize.value = size
  writeStorage('family-library:font', String(size))
}
function saveReading() {
  if (!pageId.value || !story.value || isHome.value || isMissing.value) return
  const top = story.value.getBoundingClientRect().top + window.scrollY
  const length = Math.max(1, story.value.offsetHeight - innerHeight + 100)
  const saved = {
    id: pageId.value,
    title: displayTitle.value,
    url: route.path,
    scroll: Math.max(0, window.scrollY),
    progress: Math.max(0, Math.min(100, Math.round(((window.scrollY - top + 100) / length) * 100))),
  }
  writeStorage(storageKey, JSON.stringify(saved))
  lastRead.value = saved
}
function onScroll() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveReading, 250)
  })
}
function resumeReading() {
  if (lastRead.value) writeStorage('family-library:resume', JSON.stringify(lastRead.value))
}
async function setupPage() {
  const version = ++setupVersion
  commentsObserver?.disconnect()
  clearTimeout(saveTimer)
  cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
  commentsReady.value = false
  await nextTick()
  if (version !== setupVersion || !story.value) return
  if (showComments.value && commentsSentinel.value) {
    commentsObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && version === setupVersion) {
          commentsReady.value = true
          commentsObserver?.disconnect()
        }
      },
      { rootMargin: '350px' }
    )
    commentsObserver.observe(commentsSentinel.value)
  }
  try {
    const saved = JSON.parse(readStorage('family-library:resume') || 'null')
    if (saved?.id === pageId.value && Number.isFinite(saved.scroll)) {
      requestAnimationFrame(() => {
        if (version === setupVersion)
          window.scrollTo({ top: Math.max(0, saved.scroll), behavior: 'instant' })
      })
      try {
        localStorage.removeItem('family-library:resume')
      } catch {
        /* optional */
      }
    }
  } catch {
    /* Ignore old or invalid saved preferences. */
  }
}

onMounted(() => {
  const preferred = Number(readStorage('family-library:font') ?? 1)
  if ([0, 1, 2].includes(preferred)) fontSize.value = preferred
  try {
    const saved = JSON.parse(readStorage(storageKey) || 'null')
    if (
      saved &&
      typeof saved.title === 'string' &&
      typeof saved.id === 'string' &&
      Number.isFinite(saved.scroll)
    ) {
      const entry = [...catalog.readingOrder, ...catalog.documents, catalog.fullStory].find(
        (item) => item.id === saved.id
      )
      if (entry)
        lastRead.value = {
          ...saved,
          title:
            catalog.readingOrder.find((chapter) => chapter.id === entry.id)?.subtitle ||
            entry.title,
          url: withBase(entry.url),
        }
    }
  } catch {
    /* optional */
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('pagehide', saveReading)
  setupPage()
})
watch(
  () => route.path,
  () => {
    closeDialogs()
    setupPage()
  }
)
onBeforeUnmount(() => {
  ++setupVersion
  commentsObserver?.disconnect()
  clearTimeout(saveTimer)
  cancelAnimationFrame(scrollFrame)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('pagehide', saveReading)
})
</script>

<template>
  <div class="library" :class="`font-${fontSize}`">
    <a class="skip-link" href="#main">본문으로 건너뛰기</a>

    <main v-if="isHome" id="main" tabindex="-1" class="home-main">
      <header class="home-heading">
        <h1>아버지의 기록</h1>
        <p>연대별로 엮은 배병희의 자서전입니다.</p>
        <p class="home-note">
          앞으로 등장인물 설계를 더해 배병희의 삶을 더욱 풍성하게 담은 대화 중심의 자전적 소설로
          다시 엮을 예정입니다.
        </p>
      </header>
      <a v-if="lastRead" class="resume-link" :href="lastRead.url" @click="resumeReading">
        <span
          >이어서 읽기<span class="resume-title">{{ lastRead.title }}</span></span
        >
        <Icon name="chevron" :size="16" />
      </a>
      <nav class="chapter-list" aria-label="연대별 이야기">
        <a
          v-for="chapter in catalog.readingOrder"
          :key="chapter.id"
          class="chapter-row"
          :href="withBase(chapter.url)"
        >
          <span class="chapter-copy"
            ><span class="chapter-decade">{{ chapter.decade }}</span
            ><span v-if="chapter.subtitle" class="chapter-title">{{ chapter.subtitle }}</span></span
          >
          <Icon name="chevron" :size="16" />
        </a>
      </nav>
      <a class="whole-story-link" :href="withBase(catalog.fullStory.url)"
        >전체 이야기 보기 <Icon name="chevron" :size="14"
      /></a>
      <section
        v-if="catalog.documents.length"
        class="documents-section"
        aria-labelledby="documents-title"
      >
        <h2 id="documents-title">함께 읽을 글</h2>
        <a
          v-for="doc in catalog.documents"
          :key="doc.id"
          :href="withBase(doc.url)"
          class="document-row"
          ><span>{{ doc.title }}</span
          ><Icon name="chevron" :size="16"
        /></a>
      </section>
    </main>

    <main v-else-if="isMissing" id="main" tabindex="-1" class="not-found">
      <h1>이야기를 찾지 못했습니다.</h1>
      <a class="text-link" :href="homeHref">목록으로 돌아가기</a>
    </main>

    <template v-else>
      <header class="reader-toolbar">
        <nav aria-label="읽기 도구">
          <a class="back-link" :href="homeHref"><Icon name="back" :size="18" /><span>목록</span></a>
          <div class="reader-actions">
            <button
              class="font-button"
              aria-label="글자 크기"
              aria-haspopup="dialog"
              @click="openDialog(settingsDialog)"
            >
              글자 크기
            </button>
          </div>
        </nav>
      </header>
      <main id="main" tabindex="-1" class="reader-main">
        <header class="article-header">
          <p v-if="articleLabel" class="article-label">{{ articleLabel }}</p>
          <h1>{{ displayTitle }}</h1>
        </header>
        <article ref="story" class="story-content"><Content /></article>
        <section
          v-if="showComments"
          id="comments"
          ref="commentsSentinel"
          class="comments-anchor"
          :aria-label="commentHeading"
        >
          <ClientOnly
            ><CommentsSection
              v-if="commentsReady"
              :key="pageId"
              :page-id="pageId"
              :page-title="title"
              :heading="commentHeading"
          /></ClientOnly>
        </section>
        <nav
          v-if="frontmatter.prev || frontmatter.next"
          class="chapter-navigation"
          aria-label="앞뒤 이야기"
        >
          <a v-if="frontmatter.prev" :href="withBase(frontmatter.prev.url)"
            ><span class="neighbor-label"><Icon name="back" :size="15" /> 이전 이야기</span
            ><span>{{ frontmatter.prev.decade || frontmatter.prev.title }}</span></a
          >
          <span v-else />
          <a v-if="frontmatter.next" class="next-chapter" :href="withBase(frontmatter.next.url)"
            ><span class="neighbor-label">다음 이야기 <Icon name="arrow" :size="15" /></span
            ><span>{{ frontmatter.next.decade || frontmatter.next.title }}</span></a
          >
        </nav>
      </main>
    </template>

    <dialog
      ref="settingsDialog"
      class="reading-settings"
      aria-labelledby="settings-title"
      @click="closeOnBackdrop"
    >
      <div class="dialog-body">
        <header class="dialog-heading">
          <h2 id="settings-title">글자 크기</h2>
          <button class="close-button" aria-label="글자 크기 닫기" @click="closeDialogs">
            <Icon name="close" :size="21" />
          </button>
        </header>
        <div class="size-options" role="group" aria-label="글자 크기 선택">
          <button
            v-for="(label, size) in sizeLabels"
            :key="size"
            :class="{ selected: fontSize === size }"
            :aria-pressed="fontSize === size"
            @click="setFont(size)"
          >
            {{ label }}
          </button>
        </div>
      </div>
    </dialog>
  </div>
</template>
