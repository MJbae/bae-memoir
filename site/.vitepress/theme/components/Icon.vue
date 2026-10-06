<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6 6-6-6 6-6',
  close: 'm6 6 12 12M6 18 18 6',
  chevron: 'm9 5 7 7-7 7',
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  music: 'M9 17V6l10-2v11M9 9l10-2M9 17a3 2 0 1 1-6 0 3 2 0 1 1 6 0m10-2a3 2 0 1 1-6 0 3 2 0 1 1 6 0',
  contents: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  check: 'm5 12 4 4L19 6',
}
const gear = Array.from({ length: 8 }, (_, tooth) =>
  [[0, 7.4], [8, 7.4], [12, 9.6], [30, 9.6], [34, 7.4], [45, 7.4]]
    .map(([angle, radius]) => {
      const radians = (tooth * 45 + angle) * Math.PI / 180
      return `${(12 + Math.cos(radians) * radius).toFixed(2)},${(12 + Math.sin(radians) * radius).toFixed(2)}`
    }).join(' ')
).join(' ')
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'settings'"><polygon :points="gear" /><circle cx="12" cy="12" r="3.1" /></template>
    <path v-else :d="paths[name] || paths.chevron" />
  </svg>
</template>
