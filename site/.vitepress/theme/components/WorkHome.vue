<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { catalog } from '../lib/catalog'
import Icon from './Icon.vue'

const props = defineProps<{ lastId: string | null; completed: string[] }>()
const emit = defineEmits<{ resume: [] }>()
const partDescriptions: Record<string, string> = {
  갯벌: '갯벌에서 자란 막내는 전쟁과 풍랑을 겪었다.',
  가마솥: '가정을 꾸리고 김과 멸치를 팔며 탈곡팀을 운영했다.',
  소금기: '이웃들과 고향을 떠나 간척지에 새 터를 잡았다.',
  정미소: '농민들의 부탁으로 낡은 정미소를 맡아 일으켰다.',
  볏값: '부도와 도난에도 땅을 팔아 볏값을 치렀다. 오랜 세월 함께한 아내를 떠나보냈다.',
  들녘: '네 아들이 힘을 보태며 정미소와 쌀농사를 키워 갔다.',
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
    return { label: '처음부터 읽기', episode: catalog.readingOrder[0], resume: false }
  }
  const last = catalog.readingOrder[index]
  if (!props.completed.includes(last.id)) {
    return { label: '이어서 읽기', episode: last, resume: true }
  }
  const next = catalog.readingOrder[index + 1]
  return next
    ? { label: '다음 화 읽기', episode: next, resume: false }
    : { label: '처음부터 다시 읽기', episode: catalog.readingOrder[0], resume: false }
})

</script>

<template>
  <main id="main" tabindex="-1" class="home-main">
    <section class="home-intro" aria-label="작품 소개">
      <header class="home-heading">
        <div class="home-heading-title"><h1>{{ catalog.work.title }}</h1><slot name="music" /></div>
        <p>{{ catalog.work.subtitle }} · {{ catalog.work.episodeCount }}화 완결</p>
        <p v-if="catalog.work.schedule" class="home-note">{{ catalog.work.schedule }}</p>
      </header>

      <div class="work-synopsis">
        <p v-for="paragraph in catalog.work.synopsis" :key="paragraph">{{ paragraph }}</p>
      </div>

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
    </section>

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
            <span v-if="episode.id === lastId" class="current-label">읽던 화</span>
            <span v-if="completed.includes(episode.id)" class="read-label" role="img" aria-label="읽은 회차">
              <span aria-hidden="true">✓</span>
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
