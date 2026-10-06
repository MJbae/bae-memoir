import rawCatalog from '../../generated/catalog.json'
export type Reading = { id: string; title: string; url: string }
export type Episode = Reading & { episodeId: string; label: string; number: number | null; time: string; part: { number: number; title: string; label: string } | null }
export type Neighbor = { title: string; label: string; url: string }
export const catalog = rawCatalog as {
  title: string
  work: { title: string; subtitle: string; synopsis: string[]; episodeCount: number; schedule: string }
  readingOrder: Episode[]
  legacyIds: Record<string, string>
  parts: { number: number; title: string; label: string }[]
  documents: Reading[]
}
