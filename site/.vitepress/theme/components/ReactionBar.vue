<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { emptyCounts, fetchReactions, reactionOptions, saveReaction, type Reaction } from '../lib/reactions'
const props = defineProps<{ pageId: string }>()
const emit = defineEmits<{ remember: [] }>()
const counts = ref(emptyCounts()), selected = ref<Reaction | null>(null)
const loading = ref(true), error = ref(''), status = ref(''), showRemember = ref(false)
let persisted: Reaction | null = null, revision = 0, saving = false, alive = true, lastSaved = 0
let timer: ReturnType<typeof setTimeout> | undefined
async function load() {
  loading.value = true; error.value = ''
  try {
    const data = await fetchReactions(props.pageId)
    if (alive) { counts.value = data.counts; selected.value = persisted = data.selected }
  } catch (failure) { if (alive) error.value = (failure as Error).message }
  finally { if (alive) loading.value = false }
}
function choose(key: Reaction) {
  if (loading.value) return
  const next = selected.value === key ? null : key
  if (selected.value) counts.value[selected.value] = Math.max(0, counts.value[selected.value] - 1)
  if (next) counts.value[next]++
  selected.value = next; revision++; error.value = ''; status.value = '저장 중…'
  if (next === 'remember') showRemember.value = true
  clearTimeout(timer)
  timer = setTimeout(flush, Math.max(1000, lastSaved + 1100 - Date.now()))
}
async function flush() {
  if (saving) { timer = setTimeout(flush, 1100); return }
  const current = revision, target = selected.value, pageId = props.pageId
  saving = true
  try {
    await saveReaction(pageId, target)
    persisted = target; lastSaved = Date.now()
    if (alive && current === revision) status.value = target ? '반응을 남겼어요.' : '반응을 취소했어요.'
  } catch (failure) {
    if (alive && current === revision) {
      if (selected.value) counts.value[selected.value] = Math.max(0, counts.value[selected.value] - 1)
      if (persisted) counts.value[persisted]++
      selected.value = persisted; status.value = ''; error.value = (failure as Error).message
    }
  } finally { saving = false }
}
onMounted(load)
// Keep the last scheduled write alive when the reader moves directly to the next episode.
onBeforeUnmount(() => { alive = false })
</script>
<template>
  <div class="reaction-bar">
    <div class="reaction-options" role="group" aria-label="회차 반응">
      <button v-for="option in reactionOptions" :key="option.key" type="button" :aria-pressed="selected === option.key" :aria-label="`${option.label}${counts[option.key] ? ` ${counts[option.key]}` : ''}`" :disabled="loading" @click="choose(option.key)"><span class="reaction-emoji" aria-hidden="true">{{ option.emoji }}</span><span>{{ option.label }}</span><span v-if="counts[option.key]" class="reaction-count">{{ counts[option.key] }}</span></button>
    </div>
    <p v-if="loading" class="reaction-status" role="status">반응을 불러오는 중…</p>
    <p v-if="error" class="reaction-error" role="alert">{{ error }} <button type="button" class="text-link" @click="load">다시 불러오기</button></p>
    <p v-else class="sr-only" role="status">{{ status }}</p>
    <button v-if="showRemember" type="button" class="remember-hint text-link" @click="emit('remember')">그때의 이야기를 댓글로 들려주세요. <span aria-hidden="true">↓</span></button>
  </div>
</template>
