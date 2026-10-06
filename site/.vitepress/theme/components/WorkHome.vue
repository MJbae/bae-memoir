<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import { catalog } from '../lib/catalog'
import Icon from './Icon.vue'
import ReadingLink from './ReadingLink.vue'

const props = defineProps<{ lastId: string | null; lastFinished: boolean; completed: string[] }>()
const emit = defineEmits<{ resume: [] }>()
const synopsisOpen = ref(false)
watch(() => props.lastId, () => { synopsisOpen.value = false })
const partDescriptions: Record<string, string> = {
  갯벌: '갯벌에서 자란 막내는 전쟁과 풍랑을 겪었다.',
  가마솥: '안면도에서 가정을 꾸리고 김과 멸치를 팔며 탈곡팀을 운영했다.',
  소금기: '이웃들과 독정리에 새 터를 잡고 농사와 자녀 교육을 이어갔다.',
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
  if (!props.lastFinished) {
    return { label: '이어서 읽기', episode: last, resume: true }
  }
  const next = catalog.readingOrder[index + 1]
  if (next) return { label: '다음 화 읽기', episode: next, resume: false }
  const unread = catalog.readingOrder.find(e => !props.completed.includes(e.id))
  return { label: unread ? '아직 읽지 않은 이야기' : '처음부터 다시 읽기', episode: unread || catalog.readingOrder[0], resume: false }
})

</script>

<template>
  <main id="main" tabindex="-1" class="home-main">
    <section class="home-intro" aria-label="작품 소개">
      <header class="home-heading">
        <div class="home-heading-tools"><p class="home-subtitle">{{ catalog.work.subtitle }}</p><slot name="settings" /></div>
        <div class="home-heading-title">
          <h1>{{ catalog.work.title }}</h1>
          <img class="home-portrait" :src="withBase('/images/bae-byunghee-portrait-512.jpg')" alt="배병희의 수채화 초상" width="512" height="288" />
        </div>
        <p v-if="catalog.work.schedule" class="home-note">{{ catalog.work.schedule }}</p>
      </header>

      <div v-if="lastId" class="synopsis-disclosure">
        <button type="button" class="synopsis-toggle" :aria-expanded="synopsisOpen" aria-controls="work-synopsis" @click="synopsisOpen = !synopsisOpen">
          {{ synopsisOpen ? '작품 소개 접기' : '작품 소개 보기' }}<Icon name="chevron" :size="16" />
        </button>
      </div>
      <div id="work-synopsis" class="work-synopsis" :hidden="Boolean(lastId) && !synopsisOpen">
        <p v-for="(paragraph, index) in catalog.work.synopsis" :key="paragraph" :class="{ 'synopsis-quote': index === 0 }">{{ paragraph }}</p>
      </div>

      <ReadingLink
        class="resume-link"
        :href="withBase(action.episode.url)"
        :label="action.label"
        :subtitle="lastId ? `${action.episode.label} ${action.episode.title}` : undefined"
        @click="action.resume && emit('resume')"
      />
    </section>

    <nav class="chapter-list" aria-label="회차 목록">
      <div class="chapter-list-heading"><h2>목차</h2><span>전체 {{ catalog.readingOrder.length }}편</span></div>
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
          @click="episode.id === lastId && !lastFinished && emit('resume')"
        >
          <span class="chapter-copy">
            <span class="chapter-title">
              <span class="episode-label">{{ episode.label }}</span> {{ episode.title }}
            </span>
            <span class="episode-time">{{ episode.time }}</span>
          </span>
          <span class="reading-status">
            <span v-if="episode.id === lastId" class="current-label">{{ lastFinished ? '최근 본 화' : '읽는 중' }}</span>
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
