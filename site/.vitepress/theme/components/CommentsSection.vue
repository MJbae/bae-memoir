<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  deleteComment,
  fetchComments,
  isCommentsConfigured,
  observeCommentUser,
  postComment,
  updateComment,
  toggleCommentHeart,
  type FamilyComment,
} from '../lib/comments'

const props = withDefaults(defineProps<{ pageId: string; pageTitle: string; heading?: string }>(), {
  heading: '댓글',
})
type ReplyContext = Pick<FamilyComment, 'id' | 'author' | 'body'>
type Draft = { body: string; replyTo: ReplyContext | null }

const NAME_KEY = 'family-library:comment-name'
const draftKey = (pageId: string) => `family-library:comment-draft:memoir-${pageId}`
const composerOpen = ref(false)
const selectedHearts = ref<string[]>([])
const heartBusy = ref<string | null>(null)
const heartError = ref('')
const author = ref('')
const body = ref('')
const replyTo = ref<ReplyContext | null>(null)
const comments = ref<FamilyComment[]>([])
const cursor = shallowRef<Parameters<typeof fetchComments>[1]>()
const hasMore = ref(false)
const configured = ref(false)
const ready = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const submitting = ref(false)
const loadError = ref('')
const submitError = ref('')
const authorError = ref('')
const bodyError = ref('')
const announcement = ref('')
const authorInput = ref<HTMLInputElement | null>(null)
const bodyInput = ref<HTMLTextAreaElement | null>(null)
const composer = ref<HTMLFormElement | null>(null)
const section = ref<HTMLElement | null>(null)
const currentUid = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editBody = ref('')
const editError = ref('')
const editInput = ref<HTMLTextAreaElement | null>(null)
const savingEdit = ref(false)
const deletingId = ref<string | null>(null)
const deleteError = ref<{ id: string; message: string } | null>(null)
const now = ref(0)
const cooldownUntil = ref(0)
const cooldownSeconds = computed(() =>
  Math.max(0, Math.ceil((cooldownUntil.value - now.value) / 1000))
)
const commentById = computed(() => new Map(comments.value.map((comment) => [comment.id, comment])))
let mounted = false
let restoringDraft = false
let activePageId = ''
let requestVersion = 0
let cooldownTimer: ReturnType<typeof setInterval> | undefined
let stopObservingUser: (() => void) | undefined
// A fetch started before a successful write must not undo that write in the UI.
const localComments = new Map<string, FamilyComment>()
const deletedCommentIds = new Set<string>()
const editButtons = new Map<string, HTMLButtonElement>()

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Reading and commenting still work when a browser disables local storage.
  }
}

function readDraft(pageId: string): Draft | null {
  try {
    const draft = JSON.parse(readLocal(draftKey(pageId)) || 'null')
    if (!draft || typeof draft.body !== 'string') return null
    const reply = draft.replyTo
    return {
      body: draft.body.slice(0, 2000),
      replyTo:
        reply &&
        typeof reply.id === 'string' &&
        typeof reply.author === 'string' &&
        typeof reply.body === 'string'
          ? { id: reply.id, author: reply.author.slice(0, 24), body: reply.body.slice(0, 2000) }
          : null,
    }
  } catch {
    return null
  }
}

function saveDraft() {
  if (!mounted || restoringDraft || !activePageId) return
  writeLocal(
    draftKey(activePageId),
    body.value || replyTo.value
      ? JSON.stringify({ body: body.value, replyTo: replyTo.value })
      : null
  )
}

watch([body, replyTo], saveDraft, { flush: 'sync' })
watch(author, (value) => {
  if (mounted) writeLocal(NAME_KEY, value.slice(0, 24))
  if (value.trim()) authorError.value = ''
})
watch(body, (value) => {
  if (value.trim()) bodyError.value = ''
})

function friendlyError(error: unknown, fallback: string) {
  // The data layer supplies messages intended for readers; do not expose SDK errors.
  const message = error instanceof Error ? error.message : ''
  return /^[가-힣0-9]/.test(message) && /[가-힣]/.test(message) && message.length <= 200
    ? message
    : fallback
}

async function loadComments(more = false) {
  if (!configured.value || loading.value || loadingMore.value) return
  const version = requestVersion
  const pageId = props.pageId
  loadError.value = ''
  if (more) loadingMore.value = true
  else loading.value = true
  try {
    const result = await fetchComments(pageId, more ? cursor.value : undefined)
    if (version !== requestVersion || pageId !== props.pageId) return
    const merged = new Map<string, FamilyComment>()
    for (const comment of [...(more ? comments.value : []), ...result.comments]) {
      if (!deletedCommentIds.has(comment.id)) {
        merged.set(comment.id, localComments.get(comment.id) ?? comment)
      }
    }
    for (const comment of localComments.values()) merged.set(comment.id, comment)
    comments.value = [...merged.values()].sort((a, b) => b.createdAt - a.createdAt)
    cursor.value = result.cursor
    hasMore.value = result.hasMore
  } catch (error) {
    if (version !== requestVersion || pageId !== props.pageId) return
    loadError.value = friendlyError(error, '불러오지 못했어요. 다시 시도해 주세요.')
  } finally {
    if (version === requestVersion && pageId === props.pageId) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function openPage() {
  requestVersion += 1
  activePageId = props.pageId
  restoringDraft = true
  const draft = readDraft(activePageId)
  body.value = draft?.body ?? ''
  replyTo.value = draft?.replyTo ?? null
  composerOpen.value = Boolean(draft?.body || draft?.replyTo)
  selectedHearts.value = []
  heartBusy.value = null
  heartError.value = ''
  restoringDraft = false
  comments.value = []
  localComments.clear()
  deletedCommentIds.clear()
  editButtons.clear()
  editingId.value = null
  editBody.value = ''
  editError.value = ''
  savingEdit.value = false
  deletingId.value = null
  deleteError.value = null
  cursor.value = undefined
  hasMore.value = false
  loading.value = false
  loadingMore.value = false
  submitting.value = false
  loadError.value = ''
  submitError.value = ''
  authorError.value = ''
  bodyError.value = ''
  announcement.value = ''
  configured.value = isCommentsConfigured()
  ready.value = true
  void loadComments()
}

watch(
  () => props.pageId,
  () => {
    if (mounted) openPage()
  }
)

onMounted(() => {
  mounted = true
  author.value = (readLocal(NAME_KEY) || '').slice(0, 24)
  openPage()
  if (configured.value) {
    try {
      stopObservingUser = observeCommentUser((uid) => {
        currentUid.value = uid
        restoreHearts()
        const editedComment = editingId.value && commentById.value.get(editingId.value)
        if (editedComment && editedComment.uid !== uid) {
          editingId.value = null
          editBody.value = ''
          editError.value = ''
        }
      })
    } catch {
      // The comment loader explains connection errors; ownership stays hidden.
      currentUid.value = null
    }
  }
})

onBeforeUnmount(() => {
  saveDraft()
  mounted = false
  requestVersion += 1
  stopObservingUser?.()
  editButtons.clear()
  if (cooldownTimer) clearInterval(cooldownTimer)
})

function excerpt(text: string) {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length > 72 ? `${value.slice(0, 72)}…` : value
}

function dateLabel(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '방금'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(new Date(timestamp))
}

function dateTime(timestamp: number) {
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : undefined
}

function ownsComment(comment: FamilyComment) {
  return Boolean(currentUid.value && comment.uid === currentUid.value)
}

function setEditInput(element: unknown) {
  editInput.value = element instanceof HTMLTextAreaElement ? element : null
}

function setEditButton(id: string, element: unknown) {
  if (element instanceof HTMLButtonElement) editButtons.set(id, element)
  else editButtons.delete(id)
}

async function startEdit(comment: FamilyComment) {
  if (!ownsComment(comment) || editingId.value || deletingId.value) return
  const version = requestVersion
  editingId.value = comment.id
  editBody.value = comment.body
  editError.value = ''
  deleteError.value = null
  announcement.value = '수정 중이에요.'
  await nextTick()
  if (!mounted || version !== requestVersion) return
  editInput.value?.focus({ preventScroll: true })
  editInput.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

async function cancelEdit() {
  if (savingEdit.value) return
  const id = editingId.value
  const version = requestVersion
  editingId.value = null
  editBody.value = ''
  editError.value = ''
  announcement.value = '수정을 취소했어요.'
  await nextTick()
  if (mounted && version === requestVersion && id) editButtons.get(id)?.focus()
}

async function saveEdit(comment: FamilyComment) {
  if (savingEdit.value || editingId.value !== comment.id || !ownsComment(comment)) return
  const cleanBody = editBody.value.trim()
  editError.value = !cleanBody
    ? '내용을 적어 주세요.'
    : cleanBody.length > 2000
      ? '2,000자까지 적을 수 있어요.'
      : ''
  if (editError.value) {
    await nextTick()
    editInput.value?.focus()
    return
  }
  const version = requestVersion
  const pageId = props.pageId
  savingEdit.value = true
  announcement.value = ''
  try {
    const updated = await updateComment(pageId, comment.id, cleanBody)
    if (!mounted || version !== requestVersion || pageId !== props.pageId) return
    localComments.set(updated.id, updated)
    comments.value = comments.value.map((item) => (item.id === updated.id ? updated : item))
    if (replyTo.value?.id === updated.id) {
      replyTo.value = { id: updated.id, author: updated.author, body: updated.body }
    }
    editingId.value = null
    editBody.value = ''
    editError.value = ''
    announcement.value = '수정했어요.'
    await nextTick()
    if (mounted && version === requestVersion) editButtons.get(updated.id)?.focus()
  } catch (error) {
    if (!mounted || version !== requestVersion || pageId !== props.pageId) return
    editError.value = friendlyError(error, '저장하지 못했어요. 다시 시도해 주세요.')
  } finally {
    if (mounted && version === requestVersion && pageId === props.pageId) savingEdit.value = false
  }
}

async function removeComment(comment: FamilyComment) {
  if (!ownsComment(comment) || deletingId.value || editingId.value) return
  const confirmation = comment.parentId ? '답글을 삭제할까요?' : '댓글을 삭제할까요? 답글은 남아요.'
  if (!window.confirm(confirmation)) return
  const version = requestVersion
  const pageId = props.pageId
  deletingId.value = comment.id
  deleteError.value = null
  announcement.value = ''
  try {
    await deleteComment(pageId, comment.id)
    if (!mounted || version !== requestVersion || pageId !== props.pageId) return
    deletedCommentIds.add(comment.id)
    localComments.delete(comment.id)
    comments.value = comments.value.filter((item) => item.id !== comment.id)
    if (replyTo.value?.id === comment.id) replyTo.value = null
    announcement.value = '삭제했어요.'
    await nextTick()
    if (mounted && version === requestVersion) section.value?.focus({ preventScroll: true })
  } catch (error) {
    if (!mounted || version !== requestVersion || pageId !== props.pageId) return
    deleteError.value = {
      id: comment.id,
      message: friendlyError(error, '삭제하지 못했어요. 다시 시도해 주세요.'),
    }
  } finally {
    if (mounted && version === requestVersion && pageId === props.pageId) deletingId.value = null
  }
}

async function focusComposer() {
  composerOpen.value = true
  await nextTick()
  composer.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (author.value.trim()) bodyInput.value?.focus({ preventScroll: true })
  else authorInput.value?.focus({ preventScroll: true })
}

async function startReply(comment: FamilyComment) {
  composerOpen.value = true
  replyTo.value = { id: comment.id, author: comment.author, body: comment.body }
  submitError.value = ''
  announcement.value = `${comment.author} 님에게 답글`
  await nextTick()
  bodyInput.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  bodyInput.value?.focus({ preventScroll: true })
}

async function cancelReply() {
  replyTo.value = null
  announcement.value = '답글을 취소했어요.'
  await nextTick()
  bodyInput.value?.focus()
}

function startCooldown() {
  now.value = Date.now()
  cooldownUntil.value = now.value + 15_000
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    now.value = Date.now()
    if (cooldownSeconds.value === 0 && cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = undefined
    }
  }, 1000)
}

async function submit() {
  if (submitting.value || cooldownSeconds.value || !configured.value) return
  const cleanAuthor = author.value.trim()
  const cleanBody = body.value.trim()
  authorError.value = !cleanAuthor
    ? '이름을 적어 주세요.'
    : cleanAuthor.length > 24
      ? '이름은 24자까지 적어 주세요.'
      : ''
  bodyError.value = !cleanBody
    ? '내용을 적어 주세요.'
    : cleanBody.length > 2000
      ? '2,000자까지 적을 수 있어요.'
      : ''
  if (authorError.value || bodyError.value) {
    await nextTick()
    if (authorError.value) authorInput.value?.focus()
    else bodyInput.value?.focus()
    return
  }
  const pageId = props.pageId
  const version = requestVersion
  const draftBody = body.value
  const parentId = replyTo.value?.id ?? null
  submitting.value = true
  submitError.value = ''
  announcement.value = ''
  try {
    const comment = await postComment(pageId, { author: cleanAuthor, body: cleanBody, parentId })
    if (mounted) startCooldown()
    if (!mounted || version !== requestVersion || pageId !== props.pageId) {
      const saved = readDraft(pageId)
      if (saved?.body === draftBody && (saved.replyTo?.id ?? null) === parentId)
        writeLocal(draftKey(pageId), null)
      return
    }
    localComments.set(comment.id, comment)
    comments.value = [comment, ...comments.value.filter((item) => item.id !== comment.id)]
    body.value = ''
    replyTo.value = null
    announcement.value = '남겼어요.'
  } catch (error) {
    if (!mounted || version !== requestVersion || pageId !== props.pageId) return
    submitError.value = friendlyError(error, '저장하지 못했어요. 다시 시도해 주세요.')
  } finally {
    if (mounted && version === requestVersion && pageId === props.pageId) submitting.value = false
  }
}

const heartsKey = () => `family-library:hearts:${currentUid.value}:${props.pageId}`
function restoreHearts() {
  try {
    const saved = JSON.parse(readLocal(heartsKey()) || '[]')
    selectedHearts.value = currentUid.value && Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []
  } catch { selectedHearts.value = [] }
}
async function heart(comment: FamilyComment) {
  if (heartBusy.value || ownsComment(comment)) return
  const version = requestVersion, pageId = props.pageId
  heartBusy.value = comment.id; heartError.value = ''
  try {
    const result = await toggleCommentHeart(pageId, comment.id)
    if (!mounted || version !== requestVersion) return
    selectedHearts.value = selectedHearts.value.filter(id => id !== comment.id)
    if (result.selected) selectedHearts.value.push(comment.id)
    writeLocal(heartsKey(), JSON.stringify(selectedHearts.value))
    const updated = { ...comment, heartCount: result.count }
    localComments.set(comment.id, updated)
    comments.value = comments.value.map(item => item.id === comment.id ? updated : item)
    announcement.value = result.selected ? '공감을 남겼어요.' : '공감을 취소했어요.'
  } catch (error) {
    if (mounted && version === requestVersion) heartError.value = friendlyError(error, '공감을 저장하지 못했어요. 다시 시도해 주세요.')
  } finally { if (mounted && version === requestVersion) heartBusy.value = null }
}

defineExpose({ focusComposer })
</script>

<template>
  <section
    v-if="ready && configured"
    ref="section"
    class="family-comments"
    aria-labelledby="comments-heading"
    tabindex="-1"
  >
    <h2 id="comments-heading">{{ heading }}<span v-if="!loading && !loadError"> {{ hasMore || comments.length > 30 ? '30+' : comments.length }}</span></h2>
    <button v-if="!composerOpen" type="button" class="composer-prompt" @click="focusComposer">이 회차에 대한 생각을 남겨 주세요.</button>

    <form
      ref="composer"
      v-show="composerOpen"
      class="comment-composer"
      novalidate
      :aria-label="`${pageTitle}에 댓글 남기기`"
      @submit.prevent="submit"
    >
      <div v-if="replyTo" class="reply-context">
        <div>
          <span class="reply-caption">{{ replyTo.author }} 님에게 답글</span>
          <p>{{ excerpt(replyTo.body) }}</p>
        </div>
        <button
          type="button"
          class="text-button cancel-reply"
          :disabled="submitting"
          @click="cancelReply"
        >
          취소
        </button>
      </div>

      <div class="field name-field">
        <label for="comment-author">이름</label>
        <input
          id="comment-author"
          ref="authorInput"
          v-model="author"
          name="author"
          type="text"
          placeholder="이름이나 호칭을 적어 주세요."
          autocomplete="nickname"
          maxlength="24"
          required
          :disabled="submitting"
          :aria-invalid="Boolean(authorError)"
          :aria-describedby="authorError ? 'comment-author-error' : undefined"
        />
        <p v-if="authorError" id="comment-author-error" class="field-error" role="alert">
          {{ authorError }}
        </p>
      </div>

      <div class="field">
        <label for="comment-body">{{ replyTo ? '답글' : '내용' }}</label>
        <textarea
          id="comment-body"
          ref="bodyInput"
          v-model="body"
          name="comment"
          :placeholder="
            replyTo ? '답글을 적어 주세요.' : '읽고 느낀 점이나 기억나는 이야기를 적어 주세요.'
          "
          maxlength="2000"
          rows="4"
          required
          :disabled="submitting"
          :aria-invalid="Boolean(bodyError)"
          :aria-describedby="
            bodyError ? 'comment-body-error comment-public-note' : 'comment-public-note'
          "
        />
        <p v-if="body.length >= 1800" class="character-count">
          {{ body.length.toLocaleString('ko-KR') }} / 2,000
        </p>
        <p v-if="bodyError" id="comment-body-error" class="field-error" role="alert">
          {{ bodyError }}
        </p>
      </div>

      <p id="comment-public-note" class="public-note">이름과 댓글은 공개됩니다.</p>
      <p v-if="submitError" class="error-message" role="alert">{{ submitError }}</p>
      <p
        class="announcement"
        :class="{ 'sr-only': !announcement.startsWith('남겼어요.') }"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ announcement }}
      </p>
      <div class="submit-row">
        <button
          class="submit-button"
          type="submit"
          :disabled="submitting || cooldownSeconds > 0"
          :aria-busy="submitting"
        >
          {{ submitting ? '저장 중…' : '남기기' }}
        </button>
        <p v-if="cooldownSeconds" class="cooldown-note">
          {{ cooldownSeconds }}초 후에 다시 남겨 주세요.
        </p>
      </div>
    </form>

    <p v-if="heartError" class="error-message" role="alert">{{ heartError }}</p>
    <p v-if="loading" class="comments-status" role="status">불러오는 중…</p>

    <ol v-if="comments.length" class="comment-list" aria-label="댓글 목록">
      <li
        v-for="comment in comments"
        :id="`comment-${comment.id}`"
        :key="comment.id"
        class="comment-item"
      >
        <article :aria-label="`${comment.author} 님의 ${comment.parentId ? '답글' : '댓글'}`">
          <div class="comment-meta">
            <strong>{{ comment.author }}</strong>
            <span class="comment-date">
              <time :datetime="dateTime(comment.createdAt)">{{
                dateLabel(comment.createdAt)
              }}</time>
              <span v-if="comment.updatedAt" class="comment-edited">(수정됨)</span>
            </span>
          </div>
          <div v-if="comment.parentId" class="parent-context">
            <template v-if="commentById.has(comment.parentId)">
              <span>{{ commentById.get(comment.parentId)?.author }} 님에게 답글</span>
              <p>{{ excerpt(commentById.get(comment.parentId)?.body || '') }}</p>
            </template>
            <span v-else>이전 댓글에 단 답글</span>
          </div>
          <form
            v-if="editingId === comment.id"
            class="comment-editor"
            :aria-label="`${comment.author} 님의 댓글 수정`"
            novalidate
            :aria-busy="savingEdit"
            @submit.prevent="saveEdit(comment)"
          >
            <div class="field">
              <label :for="`comment-edit-${comment.id}`" class="sr-only">댓글 수정</label>
              <textarea
                :id="`comment-edit-${comment.id}`"
                :ref="setEditInput"
                v-model="editBody"
                name="edit-comment"
                rows="4"
                maxlength="2000"
                required
                :disabled="savingEdit"
                :aria-invalid="Boolean(editError)"
                :aria-describedby="editError ? `comment-edit-error-${comment.id}` : undefined"
              />
              <p v-if="editBody.length >= 1800" class="character-count">
                {{ editBody.length.toLocaleString('ko-KR') }} / 2,000
              </p>
              <p
                v-if="editError"
                :id="`comment-edit-error-${comment.id}`"
                class="field-error"
                role="alert"
              >
                {{ editError }}
              </p>
            </div>
            <div class="edit-actions">
              <button class="text-button save-edit" type="submit" :disabled="savingEdit">
                {{ savingEdit ? '저장 중…' : '저장' }}
              </button>
              <button class="text-button" type="button" :disabled="savingEdit" @click="cancelEdit">
                취소
              </button>
            </div>
          </form>
          <template v-else>
            <p class="comment-body">{{ comment.body }}</p>
            <div class="comment-actions">
              <span v-if="ownsComment(comment)" class="own-heart"><span aria-hidden="true">♡</span> 공감해요<span v-if="comment.heartCount"> {{ comment.heartCount }}</span></span>
              <button v-else class="text-button heart-button" type="button" :aria-label="`${comment.author} 님의 댓글에 공감해요`" :aria-pressed="selectedHearts.includes(comment.id)" :disabled="Boolean(heartBusy)" @click="heart(comment)"><span aria-hidden="true">{{ selectedHearts.includes(comment.id) ? '♥' : '♡' }}</span> 공감해요<span v-if="comment.heartCount"> {{ comment.heartCount }}</span></button>
              <button
                v-if="!comment.parentId"
                class="text-button reply-button"
                type="button"
                :disabled="submitting || deletingId === comment.id"
                :aria-label="`${comment.author} 님에게 답글`"
                @click="startReply(comment)"
              >
                답글
              </button>
              <div v-if="ownsComment(comment)" class="owner-actions">
                <button
                  :ref="(element) => setEditButton(comment.id, element)"
                  class="text-button edit-button"
                  type="button"
                  :disabled="Boolean(editingId || deletingId)"
                  @click="startEdit(comment)"
                >
                  수정
                </button>
                <button
                  class="text-button delete-button"
                  type="button"
                  :disabled="Boolean(editingId || deletingId)"
                  :aria-busy="deletingId === comment.id"
                  @click="removeComment(comment)"
                >
                  {{ deletingId === comment.id ? '삭제 중…' : '삭제' }}
                </button>
              </div>
            </div>
          </template>
          <p v-if="deleteError?.id === comment.id" class="error-message" role="alert">
            {{ deleteError.message }}
          </p>
        </article>
      </li>
    </ol>

    <div v-if="loadError" class="load-error" role="alert">
      <p>{{ loadError }}</p>
      <button
        type="button"
        class="text-button retry-button"
        :disabled="loading || loadingMore"
        @click="loadComments(comments.length > 0)"
      >
        다시 불러오기
      </button>
    </div>
    <button
      v-else-if="hasMore && !loading"
      class="text-button load-more"
      type="button"
      :disabled="loadingMore"
      :aria-busy="loadingMore"
      @click="loadComments(true)"
    >
      {{ loadingMore ? '불러오는 중…' : '댓글 더 보기' }}
    </button>
  </section>
</template>

<style scoped>
.composer-prompt { width: 100%; min-height: 52px; text-align: left; padding: 12px; border: 1px solid var(--field-border); border-radius: 8px; color: var(--muted); background: var(--surface); font-size: var(--font-ui); line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.own-heart { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; min-height: 44px; padding: 8px 10px; color: var(--muted); font-size: var(--font-ui); }
.heart-button[aria-pressed='true'] { font-weight: 600; }
.family-comments {
  --comment-ink: var(--ink);
  --comment-muted: var(--muted);
  --comment-line: var(--line);
  --comment-action: var(--link);
  margin: 0;
  padding-top: 24px;
  border-top: 1px solid var(--comment-line);
  scroll-margin-top: 80px;
  color: var(--comment-ink);
  outline: none;
}
.family-comments > h2 {
  margin: 0 0 20px;
  padding: 0;
  border: 0;
  color: var(--comment-ink);
  font-size: var(--font-section);
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: -0.03em;
}
.family-comments > h2 > span {
  color: var(--comment-muted);
  font-size: var(--font-ui);
  font-weight: 400;
}
.field + .field {
  margin-top: 24px;
}
.field label {
  display: block;
  margin-bottom: 8px;
  font-size: var(--font-ui);
  font-weight: 500;
  line-height: 1.5;
}
.field input,
.field textarea {
  display: block;
  width: 100%;
  padding: 12px;
  border: 1px solid var(--field-border);
  border-radius: 8px;
  color: var(--comment-ink);
  background: var(--surface);
  font: inherit;
  font-size: var(--comment-size);
  line-height: 1.6;
  box-sizing: border-box;
}
.field input {
  min-height: 52px;
  max-width: 340px;
}
.field textarea {
  min-height: 154px;
  resize: vertical;
}
.field input::placeholder,
.field textarea::placeholder {
  color: var(--comment-muted);
  opacity: 1;
}
.field input:focus,
.field textarea:focus {
  outline: 2px solid var(--comment-action);
  outline-offset: 2px;
}
.field input[aria-invalid='true'],
.field textarea[aria-invalid='true'] {
  border-color: var(--error);
}
.field input:disabled,
.field textarea:disabled {
  opacity: 0.6;
}
.character-count {
  margin: 8px 0 0;
  color: var(--comment-muted);
  font-size: var(--font-meta);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.field-error,
.error-message,
.load-error {
  margin: 8px 0 0;
  color: var(--error);
  font-size: var(--font-ui);
  line-height: 1.7;
}
.public-note,
.cooldown-note {
  margin: 12px 0 0;
  color: var(--comment-muted);
  font-size: var(--font-meta);
  line-height: 1.6;
  word-break: keep-all;
}
.announcement {
  margin: 12px 0 0;
  font-size: var(--font-ui);
  line-height: 1.7;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.submit-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 20px;
}
.submit-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-height: 48px;
  padding: 10px 22px;
  border: 0;
  border-radius: 8px;
  color: var(--button-ink);
  background: var(--comment-action);
  font: inherit;
  font-size: var(--font-ui);
  font-weight: 500;
  line-height: 1.5;
  cursor: pointer;
}
.submit-button:hover:not(:disabled) {
  filter: brightness(0.93);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid var(--comment-action);
  outline-offset: 3px;
}
.cooldown-note {
  margin: 0;
}
.reply-context {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding-left: 12px;
  border-left: 2px solid var(--comment-line);
}
.reply-context > div {
  min-width: 0;
}
.reply-caption {
  font-size: var(--font-ui);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.reply-context p,
.parent-context {
  margin: 4px 0 0;
  color: var(--comment-muted);
  font-size: var(--font-meta);
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.text-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  min-width: 44px;
  min-height: 44px;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  color: var(--comment-action);
  font: inherit;
  font-size: var(--font-ui);
  line-height: 1.6;
  cursor: pointer;
  text-decoration: none;
}
.text-button:hover:not(:disabled) {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.cancel-reply {
  flex: 0 0 auto;
  margin-top: -8px;
}
.comments-status {
  margin: 32px 0 0;
  color: var(--comment-muted);
  font-size: var(--font-meta);
  line-height: 1.7;
}
.comment-list {
  margin: 32px 0 0;
  padding: 0;
  list-style: none;
}
.comment-item {
  margin: 0;
  padding: 24px 0 16px;
  border-top: 1px solid var(--comment-line);
  scroll-margin-top: 80px;
}
.comment-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
}
.comment-meta strong {
  color: var(--comment-ink);
  font-size: var(--font-ui);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.comment-date {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  color: var(--comment-muted);
  font-size: var(--font-meta);
  line-height: 1.6;
}
.comment-body {
  margin: 12px 0 0;
  color: var(--comment-ink);
  font-size: var(--comment-size);
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.comment-actions {
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 0 8px;
  margin: 4px -10px 0;
}
.owner-actions {
  display: flex;
  margin-left: auto;
}
.owner-actions .text-button {
  color: var(--comment-muted);
  font-size: var(--font-ui);
}
.comment-editor {
  margin-top: 12px;
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin: 8px -10px 0 0;
}
.save-edit {
  font-weight: 600;
}
.parent-context {
  margin-top: 14px;
  padding-left: 12px;
  border-left: 2px solid var(--comment-line);
}
.parent-context p {
  margin: 2px 0 0;
}
.load-more {
  display: flex;
  width: 100%;
  margin-top: 16px;
}
.load-error {
  margin-top: 24px;
}
.load-error p {
  margin: 0;
}
.retry-button {
  margin-left: -10px;
}
@media (max-width: 600px) {
  .field input {
    max-width: none;
  }
  .submit-row {
    flex-direction: column;
    align-items: stretch;
  }
  .submit-button {
    width: 100%;
    min-height: 50px;
  }
  .cooldown-note {
    text-align: center;
  }
  .comment-meta {
    flex-direction: column;
    gap: 2px;
  }
}
</style>
