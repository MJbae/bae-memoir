import { getApps, initializeApp } from 'firebase/app'
import { configuration, isCommentsConfigured } from './firebase-config'
export { isCommentsConfigured } from './firebase-config'
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  type Auth,
} from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDocFromCache,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'

export type FamilyComment = {
  id: string
  author: string
  body: string
  parentId: string | null
  uid: string
  createdAt: number
  updatedAt: number | null
  heartCount: number
}

type CommentInput = Pick<FamilyComment, 'author' | 'body' | 'parentId'>
type CommentCursor = {
  pageId: string
  snapshot: QueryDocumentSnapshot<DocumentData>
}

const PAGE_SIZE = 30
const COOLDOWN_MS = 15_000
const VALID_ID = /^[A-Za-z0-9_-]{1,120}$/
// The original autobio-bae site shares this Firebase project and stores comments
// under the bare page ID. Prefix ours so the two sites keep separate threads.
const COMMENT_NAMESPACE = 'memoir-'
export const storedPageId = (pageId: string) => `${COMMENT_NAMESPACE}${pageId}`

let clients: { auth: Auth; db: Firestore } | undefined
let signingIn: ReturnType<typeof signInAnonymously> | undefined

export function getClients() {
  if (typeof window === 'undefined') {
    throw new Error('브라우저에서 댓글을 이용해 주세요.')
  }
  if (!isCommentsConfigured()) {
    throw new Error('댓글 기능을 준비 중이에요.')
  }
  if (clients) return clients

  const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
  if (useEmulators && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
    throw new Error('연결 오류예요. 운영자에게 알려 주세요.')
  }

  const existingApp = getApps().find((app) => app.name === 'family-comments')
  const app = existingApp ?? initializeApp(configuration, 'family-comments')
  const auth = getAuth(app)
  const db = getFirestore(app)
  // A named app also survives Vite hot reloads; connect its emulators only once.
  if (useEmulators && !existingApp) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
  clients = { auth, db }
  return clients
}

export function validatePageId(pageId: string) {
  if (!VALID_ID.test(pageId)) {
    throw new Error('연결 오류예요. 운영자에게 알려 주세요.')
  }
}

type CommentAction = 'read' | 'post' | 'update' | 'delete'

function readableError(error: unknown, action: CommentAction): Error {
  if (error instanceof Error && !('code' in error)) return error
  const code = (error as { code?: string })?.code ?? ''
  if (code.includes('permission-denied')) {
    return new Error(
      action === 'post'
        ? '등록하지 못했어요. 15초 후에 다시 시도해 주세요.'
        : action === 'read'
          ? '불러올 수 없어요. 운영자에게 알려 주세요.'
          : '수정·삭제할 수 없어요. 작성한 브라우저인지 확인해 주세요.'
    )
  }
  if (
    code.includes('operation-not-allowed') ||
    code.includes('invalid-api-key') ||
    code.includes('unauthorized-domain') ||
    code.includes('configuration-not-found')
  ) {
    return new Error('연결 오류예요. 운영자에게 알려 주세요.')
  }
  if (code.includes('too-many-requests') || code.includes('resource-exhausted')) {
    return new Error('잠시 후에 다시 시도해 주세요.')
  }
  if (
    code.includes('network-request-failed') ||
    code.includes('unavailable') ||
    code.includes('deadline-exceeded')
  ) {
    return new Error('인터넷 연결을 확인해 주세요.')
  }
  if (code.includes('not-found')) {
    return new Error(
      action === 'update' || action === 'delete'
        ? '댓글이 없어요. 목록을 새로고침해 주세요.'
        : '연결 오류예요. 운영자에게 알려 주세요.'
    )
  }
  const failure = {
    read: '불러오지 못했어요.',
    post: '저장하지 못했어요.',
    update: '저장하지 못했어요.',
    delete: '삭제하지 못했어요.',
  }[action]
  return new Error(`${failure} 다시 시도해 주세요.`)
}

function toComment(snapshot: QueryDocumentSnapshot<DocumentData>): FamilyComment {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    author: data.author,
    body: data.body,
    parentId: data.parentId,
    uid: data.uid,
    createdAt: data.createdAt.toMillis(),
    updatedAt: data.updatedAt?.toMillis() ?? null,
    heartCount: Number.isInteger(data.heartCount) ? data.heartCount : 0,
  }
}

// Observing ownership never signs a reader in or replaces a lost session.
export function observeCommentUser(callback: (uid: string | null) => void): () => void {
  const { auth } = getClients()
  return onAuthStateChanged(auth, (user) => callback(user?.isAnonymous ? user.uid : null))
}

function validateCommentId(commentId: string) {
  if (!VALID_ID.test(commentId)) {
    throw new Error('목록을 새로고침해 주세요.')
  }
}

function validBody(input: string): string {
  const body = input.trim()
  if (!body || body.length > 2000) {
    throw new Error('내용은 1~2,000자로 적어 주세요.')
  }
  return body
}

async function existingCommentUser(auth: Auth) {
  await auth.authStateReady()
  const user = auth.currentUser
  if (!user?.isAnonymous) {
    throw new Error('작성한 브라우저에서 수정·삭제해 주세요.')
  }
  return user
}

export async function fetchComments(
  pageId: string,
  cursor?: unknown
): Promise<{
  comments: FamilyComment[]
  cursor: unknown
  hasMore: boolean
}> {
  validatePageId(pageId)
  try {
    const { db } = getClients()
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc'), limit(PAGE_SIZE)]
    if (cursor) {
      const previous = cursor as CommentCursor
      if (previous.pageId !== pageId || !previous.snapshot) {
        throw new Error('목록을 새로고침해 주세요.')
      }
      constraints.push(startAfter(previous.snapshot))
    }
    // One bounded read per request, rather than a permanent realtime listener.
    const result = await getDocsFromServer(
      query(collection(db, 'pages', storedPageId(pageId), 'comments'), ...constraints)
    )
    return {
      comments: result.docs.map(toComment),
      cursor: result.empty ? null : { pageId, snapshot: result.docs[result.docs.length - 1] },
      hasMore: result.size === PAGE_SIZE,
    }
  } catch (error) {
    throw readableError(error, 'read')
  }
}

export async function postComment(pageId: string, input: CommentInput): Promise<FamilyComment> {
  validatePageId(pageId)
  const author = input.author.trim()
  const body = validBody(input.body)
  const parentId = input.parentId
  if (!author || author.length > 24 || /[\r\n]/.test(author)) {
    throw new Error('이름은 한 줄로, 1~24자로 적어 주세요.')
  }
  if (parentId !== null && !VALID_ID.test(parentId)) {
    throw new Error('답글 달 댓글을 다시 골라 주세요.')
  }

  try {
    const { auth, db } = getClients()
    if (parentId) {
      const parent = await getDocFromServer(
        doc(db, 'pages', storedPageId(pageId), 'comments', parentId)
      )
      if (!parent.exists() || parent.data().parentId !== null) {
        throw new Error('원댓글이 없어요. 답글을 취소하고 새로 남겨 주세요.')
      }
    }
    // Reading never creates an anonymous account. Restore the existing session
    // before creating one, so reloading does not circumvent the same-UID limit.
    const user = await ensureAnonymousUser()

    const rateRef = doc(db, 'rateLimits', user.uid)
    const rate = await getDocFromServer(rateRef)
    const previousTime = rate.data()?.lastCommentAt?.toMillis() ?? 0
    const elapsed = Date.now() - previousTime
    const waitSeconds = Math.ceil((COOLDOWN_MS - elapsed) / 1000)
    // A device clock behind the server must not lock the visitor out. Rules
    // remain authoritative when device time cannot support this friendly check.
    if (elapsed >= 0 && waitSeconds > 0) {
      throw new Error(`${waitSeconds}초 후에 다시 남겨 주세요.`)
    }

    const commentRef = doc(collection(db, 'pages', storedPageId(pageId), 'comments'))
    const batch = writeBatch(db)
    batch.set(commentRef, { author, body, parentId, uid: user.uid, createdAt: serverTimestamp() })
    batch.set(rateRef, {
      lastCommentAt: serverTimestamp(),
      lastCommentId: commentRef.id,
      lastPageId: storedPageId(pageId),
    })
    // Rules require this pair of writes and enforce the cooldown atomically.
    await batch.commit()

    // The acknowledged write includes the resolved server timestamp in the
    // memory cache. A cache miss must not report a successful post as a failure.
    let createdAt = Date.now()
    try {
      const saved = await getDocFromCache(commentRef)
      createdAt = saved.data()?.createdAt?.toMillis() ?? createdAt
    } catch {
      /* The next refresh will retrieve the canonical server timestamp. */
    }
    return { id: commentRef.id, author, body, parentId, uid: user.uid, createdAt, updatedAt: null, heartCount: 0 }
  } catch (error) {
    throw readableError(error, 'post')
  }
}

export async function updateComment(
  pageId: string,
  commentId: string,
  input: string
): Promise<FamilyComment> {
  validatePageId(pageId)
  validateCommentId(commentId)
  const body = validBody(input)
  try {
    const { auth, db } = getClients()
    const user = await existingCommentUser(auth)
    const commentRef = doc(db, 'pages', storedPageId(pageId), 'comments', commentId)
    const original = await getDocFromServer(commentRef)
    if (!original.exists()) {
      throw new Error('삭제된 댓글이에요. 목록을 새로고침해 주세요.')
    }
    if (original.data().uid !== user.uid) {
      throw new Error('작성한 브라우저에서 수정·삭제해 주세요.')
    }
    // updateDoc cannot recreate a comment deleted while the editor was open.
    // Replies remain editable even when their original parent is gone.
    await updateDoc(commentRef, { body, updatedAt: serverTimestamp() })
    let updatedAt = Date.now()
    try {
      const saved = await getDocFromCache(commentRef)
      updatedAt = saved.data()?.updatedAt?.toMillis() ?? updatedAt
    } catch {
      /* A successful write stays successful if its cache entry is unavailable. */
    }
    return { ...toComment(original), body, updatedAt }
  } catch (error) {
    throw readableError(error, 'update')
  }
}

export async function deleteComment(pageId: string, commentId: string): Promise<void> {
  validatePageId(pageId)
  validateCommentId(commentId)
  try {
    const { auth, db } = getClients()
    const user = await existingCommentUser(auth)
    const commentRef = doc(db, 'pages', storedPageId(pageId), 'comments', commentId)
    const original = await getDocFromServer(commentRef)
    // A retry after successful deletion has already achieved the desired state.
    if (!original.exists()) return
    if (original.data().uid !== user.uid) {
      throw new Error('작성한 브라우저에서 수정·삭제해 주세요.')
    }
    // Hard-delete only this document. Other people's replies remain intact.
    await deleteDoc(commentRef)
  } catch (error) {
    throw readableError(error, 'delete')
  }
}

// Shared by comments and reactions: observing a reader never creates an account.
export async function ensureAnonymousUser() {
  const { auth } = getClients()
  await auth.authStateReady()
  if (auth.currentUser) {
    if (!auth.currentUser.isAnonymous) throw new Error('익명 방문자 세션을 확인해 주세요.')
    return auth.currentUser
  }
  signingIn ??= signInAnonymously(auth).finally(() => { signingIn = undefined })
  return (await signingIn).user
}

export async function toggleCommentHeart(pageId: string, commentId: string): Promise<{ selected: boolean; count: number }> {
  validatePageId(pageId); validateCommentId(commentId)
  try {
    const { db } = getClients()
    const user = await ensureAnonymousUser()
    const comment = doc(db, 'pages', storedPageId(pageId), 'comments', commentId)
    const heart = doc(comment, 'hearts', user.uid)
    const [original, existing] = await Promise.all([getDocFromServer(comment), getDocFromServer(heart)])
    if (!original.exists()) throw new Error('댓글이 없어요. 목록을 새로고침해 주세요.')
    if (original.data().uid === user.uid) throw new Error('내 댓글에는 하트를 누를 수 없어요.')
    const selected = !existing.exists()
    const batch = writeBatch(db)
    if (selected) batch.set(heart, { createdAt: serverTimestamp() })
    else batch.delete(heart)
    batch.update(comment, { heartCount: increment(selected ? 1 : -1) })
    await batch.commit()
    // The server enforces the paired writes; this cache includes resolved transforms.
    const saved = await getDocFromCache(comment).catch(() => null)
    return { selected, count: saved?.data()?.heartCount ?? Math.max(0, (original.data().heartCount || 0) + (selected ? 1 : -1)) }
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error
    throw new Error('하트를 저장하지 못했어요. 목록을 새로고침하고 다시 시도해 주세요.')
  }
}
