<script setup lang="ts">
import Icon from './Icon.vue'
defineEmits<{ open: [] }>()
</script>

<template>
  <button type="button" class="settings-button" aria-haspopup="dialog" @click="$emit('open')">
    <Icon name="settings" :size="18" /><span>설정</span>
  </button>
</template>
