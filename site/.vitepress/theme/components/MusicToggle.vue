<script setup lang="ts">
import { computed } from 'vue'
import type { MusicStatus } from '../lib/background-music'
import Icon from './Icon.vue'

const props = defineProps<{ enabled: boolean; status: MusicStatus }>()
const emit = defineEmits<{ toggle: [] }>()
const active = computed(() => props.enabled && ['playing', 'loading'].includes(props.status))
const label = computed(() => active.value ? '음악 일시정지' : '음악 재생')
</script>

<template>
  <button type="button" class="music-toggle" :aria-label="label" :title="label" :aria-pressed="active" @click="emit('toggle')">
    <Icon :name="active ? 'pause' : 'play'" :size="20" />
  </button>
</template>
