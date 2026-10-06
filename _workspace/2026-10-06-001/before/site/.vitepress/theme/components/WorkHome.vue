<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { catalog } from '../lib/catalog'
import Icon from './Icon.vue'

const props = defineProps<{ lastId: string | null; completed: string[] }>()
const emit = defineEmits<{ resume: [] }>()
const partDescriptions: Record<string, string> = {
  갯벌: '섬의 막내, 전쟁과 바다',
  가마솥: '혼인, 김과 멸치, 발동기 탈곡팀',
  소금기: '섬을 떠나 간척지에 서다',
  정미소: '쓰러져 가던 방앗간을 맡다',
  볏값: '부도와 도난, 마지막 땅, 이별',
  들녘: '아들들과 함께 넓힌 들판',
}

const groups = computed(() => {
  const rows: {
    part: typeof catalog.parts[number] | null
    episodes: typeof catalog.readingOrder
  }[] = []
  for (const episode of catalog.readingOrder) {
    const part = episode.part
    if (!rows.length || rows[rows.length - 1].part?.number !== part?.number) {
      rows.push({ part, episodes: [] })
    }
    rows[rows.length - 1].episodes.push(episode)
  }
  return rows
})

const action = computed(() => {
  const index = catalog.readingOrder.findIndex(e => e.id === props.lastId)
  if (index < 0) {
    return { label: '첫 화 보기', episode: catalog.readingOrder[0], resume: false }
  }
  const last = catalog.readingOrder[index]
  if (!props.completed.includes(last.id)) {
    return { label: '이어보기', episode: last, resume: true }
  }
  const next = catalog.readingOrder[index + 1]
  return next
    ? { label: '다음 화 보기', episode: next, resume: false }
    : { label: '다시 보기', episode: catalog.readingOrder[0], resume: false }
})

function focusPart(number: number) {
  document.getElementById(`part-${number}`)?.focus({ preventScroll: true })
}
</script>

<template>
  <main id="main" tabindex="-1" class="home-main">
    <header class="home-heading">
      <p class="library-name">아버지의 기록</p>
      <h1>{{ catalog.work.title }}</h1>
      <p>{{ catalog.work.subtitle }} · {{ catalog.work.episodeCount }}화 완결</p>
      <p v-if="catalog.work.schedule" class="home-note">{{ catalog.work.schedule }}</p>
    </header>

    <a
      class="primary-link resume-link"
      :href="withBase(action.episode.url)"
      @click="action.resume && emit('resume')"
    >
      <span>
        <span>{{ action.label }}</span>
        <span v-if="lastId" class="resume-title">
          {{ action.episode.label }} {{ action.episode.title }}
        </span>
      </span>
      <Icon name="chevron" :size="18" />
    </a>

    <div class="work-synopsis">
      <p v-for="paragraph in catalog.work.synopsis" :key="paragraph">{{ paragraph }}</p>
    </div>

    <nav class="part-shortcuts" aria-label="부별 바로가기">
      <a
        v-for="part in catalog.parts"
        :key="part.number"
        :href="`#part-${part.number}`"
        @click="focusPart(part.number)"
      >
        <span class="shortcut-number">{{ part.number }}부</span>
        <span>{{ part.title }}</span>
      </a>
    </nav>

    <nav class="chapter-list" aria-label="회차 목록">
      <section v-for="(group, index) in groups" :key="index">
        <div v-if="group.part" class="part-heading-block">
          <h2 :id="`part-${group.part.number}`" class="part-heading" tabindex="-1">
            {{ group.part.label }}
          </h2>
          <p v-if="partDescriptions[group.part.title]" class="part-description">
            {{ partDescriptions[group.part.title] }}
          </p>
        </div>
        <a
          v-for="episode in group.episodes"
          :id="`episode-${episode.episodeId}`"
          :key="episode.id"
          class="chapter-row"
          :class="{
            'is-read': completed.includes(episode.id),
            'is-current': episode.id === lastId,
          }"
          :href="withBase(episode.url)"
          :aria-current="episode.id === lastId ? 'location' : undefined"
        >
          <span class="chapter-copy">
            <span class="chapter-title">
              <span class="episode-label">{{ episode.label }}</span> {{ episode.title }}
            </span>
            <span class="episode-time">{{ episode.time }}</span>
          </span>
          <span class="reading-status">
            <span v-if="episode.id === lastId" class="current-label">보던 화</span>
            <span v-if="completed.includes(episode.id)" class="read-label">
              <span aria-hidden="true">✓</span><span>읽음</span>
            </span>
            <Icon
              v-if="episode.id !== lastId && !completed.includes(episode.id)"
              name="chevron"
              :size="16"
            />
          </span>
        </a>
      </section>
    </nav>

    <a class="whole-story-link" :href="withBase(catalog.fullStory.url)">
      한 번에 읽기 <Icon name="chevron" :size="14" />
    </a>
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
      >
        <span>{{ doc.title }}</span><Icon name="chevron" :size="16" />
      </a>
    </section>
  </main>
</template>
