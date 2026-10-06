<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import { isCommentsConfigured } from '../lib/firebase-config'
import type { Neighbor } from '../lib/catalog'
import Icon from './Icon.vue'
const props = defineProps<{ pageId: string; title: string; prev?: Neighbor | null; next?: Neighbor | null; homeHref: string; episode: boolean }>()
const emit = defineEmits<{ complete: [] }>()
const CommentsSection = defineAsyncComponent(() => import('./CommentsSection.vue'))
const ReactionBar = defineAsyncComponent(() => import('./ReactionBar.vue'))
const enabled = isCommentsConfigured()
const ready = ref(false)
const end = ref<HTMLElement>()
const comments = ref<{ focusComposer: () => Promise<void> }>()
let loadObserver: IntersectionObserver | undefined, readObserver: IntersectionObserver | undefined
async function remember() { await nextTick(); await comments.value?.focusComposer() }
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
      <ClientOnly><ReactionBar v-if="ready" :page-id="pageId" @remember="remember" /></ClientOnly>
    </section>
    <template v-if="episode">
      <a class="primary-link next-episode" :href="next ? withBase(next.url) : homeHref"><span>{{ next ? `다음 화 · ${next.label} ${next.title}` : '목록으로 돌아가기' }}</span><Icon name="chevron" :size="18" /></a>
      <nav class="episode-navigation" aria-label="앞뒤 회차">
        <a v-if="prev" :href="withBase(prev.url)"><Icon name="back" :size="15" /><span>{{ prev.label }} {{ prev.title }}</span></a><span v-else />
        <a :href="homeHref">목록</a>
      </nav>
    </template>
    <section v-if="enabled" id="comments" class="comments-anchor" aria-label="댓글">
      <ClientOnly><CommentsSection v-if="ready" ref="comments" :page-id="pageId" :page-title="title" /></ClientOnly>
    </section>
  </div>
</template>
