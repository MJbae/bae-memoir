<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6 6-6-6 6-6',
  close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm9 5 7 7-7 7',
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.chevron" />
  </svg>
</template>
