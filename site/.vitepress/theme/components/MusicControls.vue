<script setup lang="ts">
import { computed } from 'vue'
import type { MusicTrack } from '../../shared/music.mjs'
import type { MusicStatus } from '../lib/background-music'
import Icon from './Icon.vue'

const props = defineProps<{ track: MusicTrack; enabled: boolean; volume: number; status: MusicStatus }>()
const emit = defineEmits<{ toggle: []; volume: [value: number] }>()
const active = computed(() => props.enabled && ['playing', 'loading'].includes(props.status))
const message = computed(() => props.status === 'blocked'
  ? '화면을 누르면 음악이 재생됩니다.'
  : props.status === 'error' ? '음악을 불러오지 못했습니다. 음악 켜기를 눌러 다시 시도해 주세요.' : '')
</script>

<template>
  <section class="music-controls" aria-label="배경 음악">
    <span class="music-track"><Icon name="music" :size="18" />{{ track.label }}</span>
    <button class="music-toggle" :aria-pressed="active" @click="emit('toggle')">
      <Icon :name="active ? 'pause' : 'play'" :size="18" />
      {{ active ? '음악 끄기' : '음악 켜기' }}
    </button>
    <label v-if="enabled" class="music-volume">
      <span>음량</span>
      <input type="range" min="0" max="1" step="0.05" :value="volume" aria-label="음악 음량"
        @input="emit('volume', Number(($event.target as HTMLInputElement).value))" />
    </label>
    <p v-if="message" class="music-message" role="status">{{ message }}</p>
  </section>
</template>
