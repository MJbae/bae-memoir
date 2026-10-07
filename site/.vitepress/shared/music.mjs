import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

/** Index songs by episode number, then expose them under the published page IDs. */
export function loadMusic(root, episodes) {
  const filename = path.join(root, 'content/music.json')
  if (!existsSync(filename)) return null
  const manifest = JSON.parse(readFileSync(filename, 'utf8'))
  if (manifest.version !== 2 || !Array.isArray(manifest.tracks))
    throw new Error('배경 음악 목록의 형식을 확인하세요.')
  const publicRoot = path.join(root, 'site/public')
  const registered = new Set()
  function asset(src) {
    if (typeof src !== 'string' || !/^\/music\/[a-z0-9][a-z0-9-]*\.mp3$/.test(src) || registered.has(src))
      throw new Error(`배경 음악 파일 경로가 잘못되었거나 중복되었습니다: ${src}`)
    const file = path.join(publicRoot, src)
    if (!existsSync(file) || !statSync(file).isFile() || !statSync(file).size ||
        !realpathSync(file).startsWith(`${realpathSync(publicRoot)}${path.sep}`))
      throw new Error(`배경 음악 파일이 없습니다: ${src}`)
    registered.add(src)
    return src
  }
  const home = { src: asset(manifest.intro), label: '작품 소개 음악' }
  let sideNumber = 0
  const byIndex = new Map(episodes.map(episode => {
    const index = episode.kind === 'episode' ? episode.number : episode.kind === 'side'
      ? (++sideNumber === 1 ? 'side' : `side-${sideNumber}`) : episode.kind
    return [index, episode]
  }))
  const tracks = {}
  for (const track of manifest.tracks) {
    const episode = byIndex.get(track.episode)
    if (!episode || Object.hasOwn(tracks, episode.id))
      throw new Error(`배경 음악의 회차가 잘못되었거나 중복되었습니다: ${track.episode}`)
    tracks[episode.id] = { src: asset(track.src), label: `${episode.label} 음악` }
  }
  for (const episode of episodes) {
    if (!Object.hasOwn(tracks, episode.id)) throw new Error(`회차의 배경 음악이 없습니다: ${episode.id}`)
  }
  for (const entry of readdirSync(path.join(publicRoot, 'music'), { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.mp3$/i.test(entry.name)) {
      const src = '/' + path.relative(publicRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
      if (!registered.has(src)) throw new Error(`서비스에 연결하지 않은 음악이 있습니다: ${src}`)
    }
  }
  return { home, episodes: tracks }
}
