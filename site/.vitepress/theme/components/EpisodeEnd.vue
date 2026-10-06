<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import { isFirebaseConfigured } from '../lib/firebase-config'
import type { Neighbor } from '../lib/catalog'
import Icon from './Icon.vue'
const props = defineProps<{ pageId: string; prev?: Neighbor | null; next?: Neighbor | null; homeHref: string; episode: boolean }>()
const emit = defineEmits<{ complete: [] }>()
const ReactionBar = defineAsyncComponent(() => import('./ReactionBar.vue'))
const enabled = isFirebaseConfigured()
const ready = ref(false)
const end = ref<HTMLElement>()
let loadObserver: IntersectionObserver | undefined, readObserver: IntersectionObserver | undefined
onMounted(() => {
  if (!end.value) return
  if (enabled) {
    loadObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { ready.value = true; loadObserver?.disconnect() }
    }, { rootMargin: '350px' })
    loadObserver.observe(end.value)
  }
  if (props.episode) {
    readObserver = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { emit('complete'); readObserver?.disconnect() }
    })
    readObserver.observe(end.value)
  }
})
onBeforeUnmount(() => { loadObserver?.disconnect(); readObserver?.disconnect() })
</script>
<template>
  <div class="episode-end">
    <div ref="end" class="story-end" aria-label="회차 끝">⁂</div>
    <section v-if="enabled && episode" id="reactions" class="reactions-anchor" aria-label="이 회차에 반응 남기기">
      <ClientOnly><ReactionBar v-if="ready" :page-id="pageId" /></ClientOnly>
    </section>
    <nav v-if="episode" class="episode-navigation" :class="{ 'has-previous': prev }" aria-label="회차 이동">
      <a v-if="prev" class="previous-episode" :href="withBase(prev.url)">
        <Icon name="back" :size="18" />
        <span>
          <span class="previous-episode-action">이전 화 읽기</span>
          <span class="previous-episode-title">{{ prev.label }} · {{ prev.title }}</span>
        </span>
      </a>
      <a class="primary-link next-episode" :href="next ? withBase(next.url) : homeHref">
        <span class="next-episode-copy">
          <span class="next-episode-action">{{ next ? '다음 화 읽기' : '전체 회차 보기' }}</span>
          <span v-if="next" class="next-episode-title">{{ next.label }} · {{ next.title }}</span>
        </span>
        <Icon name="chevron" :size="18" />
      </a>
    </nav>
  </div>
</template>
