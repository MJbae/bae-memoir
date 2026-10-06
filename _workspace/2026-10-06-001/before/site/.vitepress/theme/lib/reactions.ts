import { collection, doc, getAggregateFromServer, getDocFromServer, serverTimestamp, setDoc, sum } from 'firebase/firestore'
import { ensureAnonymousUser, getClients, storedPageId, validatePageId } from './comments'
export const reactionOptions = [
  { key: 'heart', emoji: '❤️', label: '하트' },
  { key: 'like', emoji: '👍', label: '좋아요' },
  { key: 'moved', emoji: '😢', label: '뭉클해요' },
  { key: 'wow', emoji: '👏', label: '대단해요' },
  { key: 'remember', emoji: '💭', label: '기억나요' },
] as const
export type Reaction = typeof reactionOptions[number]['key']
export type Counts = Record<Reaction, number>
export const emptyCounts = (): Counts => ({ heart: 0, like: 0, moved: 0, wow: 0, remember: 0 })
export async function fetchReactions(pageId: string): Promise<{ counts: Counts; selected: Reaction | null }> {
  validatePageId(pageId)
  try {
    const { db, auth } = getClients()
    await auth.authStateReady()
    const reactions = collection(db, 'pages', storedPageId(pageId), 'reactions')
    const [totals, own] = await Promise.all([
      getAggregateFromServer(reactions, { heart: sum('heart'), like: sum('like'), moved: sum('moved'), wow: sum('wow'), remember: sum('remember') }),
      auth.currentUser?.isAnonymous ? getDocFromServer(doc(reactions, auth.currentUser.uid)) : Promise.resolve(null),
    ])
    return { counts: totals.data(), selected: reactionOptions.find(option => own?.data()?.[option.key] === 1)?.key || null }
  } catch { throw new Error('반응' + '을 불러오지 못했어요. 다시 시도해 주세요.') }
}
export async function saveReaction(pageId: string, selected: Reaction | null) {
  validatePageId(pageId)
  try {
    const { db } = getClients()
    const user = await ensureAnonymousUser()
    const values = emptyCounts()
    if (selected) values[selected] = 1
    await setDoc(doc(db, 'pages', storedPageId(pageId), 'reactions', user.uid), { ...values, updatedAt: serverTimestamp() })
  } catch { throw new Error('반응을 저장하지 못했어요. 잠시 후에 다시 시도해 주세요.') }
}
