import { onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue'
import { withBase } from 'vitepress'
import type { MusicTrack } from '../../shared/music.mjs'

export type MusicStatus = 'paused' | 'loading' | 'playing' | 'blocked' | 'error'
const storageKey = 'family-library:music'

export function useBackgroundMusic(track: ComputedRef<MusicTrack | undefined>) {
  const audio = ref<HTMLAudioElement>()
  const enabled = ref(true)
  const volume = ref(0.3)
  const status = ref<MusicStatus>('loading')
  let mounted = false
  let revision = 0
  let nativeVolume = true
  let context: AudioContext | undefined
  let gain: GainNode | undefined

  function applyVolume() {
    if (gain && context) gain.gain.setTargetAtTime(volume.value, context.currentTime, 0.015)
    else if (audio.value && nativeVolume) audio.value.volume = volume.value
  }

  function prepareVolume(fromGesture: boolean) {
    if (nativeVolume || !audio.value) return
    // iOS keeps HTMLMediaElement.volume at 1; a gain node controls the music instead.
    if (!context) {
      context = new AudioContext()
      gain = context.createGain()
      gain.gain.value = volume.value
      context.createMediaElementSource(audio.value).connect(gain)
      gain.connect(context.destination)
    }
    if (context.state !== 'running' && !fromGesture)
      throw new DOMException('Music needs a button gesture', 'NotAllowedError')
    return context.resume()
  }

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({ enabled: enabled.value, volume: volume.value })) }
    catch { /* Reading and music still work without browser storage. */ }
  }

  async function play(fromGesture = false) {
    const element = audio.value
    if (!element || !enabled.value || !track.value) return
    const current = ++revision
    const src = withBase(track.value.src)
    status.value = 'loading'
    try {
      const ready = prepareVolume(fromGesture)
      if (element.getAttribute('src') !== src || element.error) {
        element.pause()
        element.setAttribute('src', src)
        element.load()
      }
      // Both requests happen within the click gesture before awaiting either one.
      await Promise.all([ready, element.play()])
      if (current === revision) status.value = element.paused ? 'paused' : 'playing'
    } catch (error) {
      if (current !== revision) return
      status.value = error instanceof Error && error.name === 'NotAllowedError' ? 'blocked' : 'error'
    }
  }

  function stop() {
    ++revision
    audio.value?.pause()
    // Release the old song and cancel pending downloads when music is off or the page changes.
    audio.value?.removeAttribute('src')
    audio.value?.load()
    status.value = 'paused'
  }

  function changeTrack() {
    stop()
    if (enabled.value && track.value) void play()
  }

  function toggle() {
    if (enabled.value && (status.value === 'playing' || status.value === 'loading')) {
      enabled.value = false
      stop()
      void context?.suspend()
    } else {
      enabled.value = true
      // Call play directly from the button gesture, including after autoplay was blocked.
      void play(true)
    }
    persist()
  }

  function setVolume(value: number) {
    if (!Number.isFinite(value)) return
    volume.value = Math.min(1, Math.max(0, value))
    applyVolume()
    persist()
  }

  function onPause() {
    if (audio.value?.paused && status.value === 'playing') status.value = 'paused'
  }
  function onError() {
    if (enabled.value && track.value && audio.value?.error) status.value = 'error'
  }
  function onInteraction(event: Event) {
    if (!enabled.value || status.value !== 'blocked') return
    // The music button handles its own gesture; avoid starting and then toggling it off.
    if (event.target instanceof Element && event.target.closest('.music-toggle')) return
    void play(true)
  }

  onMounted(() => {
    mounted = true
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
      if (typeof saved?.enabled === 'boolean') enabled.value = saved.enabled
      if (typeof saved?.volume === 'number' && Number.isFinite(saved.volume))
        volume.value = Math.min(1, Math.max(0, saved.volume))
    } catch { /* Use the default music settings if storage is unavailable. */ }
    if (audio.value) {
      try {
        audio.value.volume = 0.3
        nativeVolume = Math.abs(audio.value.volume - 0.3) < 0.001
      } catch { nativeVolume = false }
      applyVolume()
      audio.value.addEventListener('pause', onPause)
      audio.value.addEventListener('error', onError)
    }
    // Wait until the click target is resolved before removing the autoplay hint from layout.
    window.addEventListener('click', onInteraction)
    window.addEventListener('keydown', onInteraction)
    changeTrack()
  })
  watch(() => track.value?.src, () => { if (mounted) changeTrack() }, { flush: 'post' })
  onBeforeUnmount(() => {
    audio.value?.removeEventListener('pause', onPause)
    audio.value?.removeEventListener('error', onError)
    window.removeEventListener('click', onInteraction)
    window.removeEventListener('keydown', onInteraction)
    stop()
    void context?.close()
  })
  return { audio, enabled, volume, status, toggle, setVolume }
}
