import type { MarkdownOptions } from 'vitepress'

type Markdown = Parameters<NonNullable<MarkdownOptions['config']>>[0]
export type Illustration = {
  id: string
  episodeId: string
  alt: string
  width: number
  height: number
  position: { start?: boolean; beforeParagraph?: string }
  sources: { src: string; width: number }[]
  webpSources?: { src: string; width: number }[]
}

export function episodeIllustrations(md: Markdown, options: { base: string; images: Record<string, Illustration[]> }) {
  md.core.ruler.after('inline', 'episode_illustrations', state => {
    const frontmatter = state.env.frontmatter
    if (frontmatter?.kind !== 'episode') return
    const episodeId = String(frontmatter.episodeId || '')
    let pendingStart = false
    let inserted = 0
    const tokens: typeof state.tokens = []
    const append = (illustration: Illustration) => {
      const token = new state.Token('episode_illustration', '', 0)
      token.block = true
      token.meta = { illustration, first: inserted++ === 0 }
      tokens.push(token)
    }
    state.tokens.forEach((token, index) => {
      if (token.type === 'heading_open' && token.level === 0) {
        if (token.tag === 'h1') pendingStart = true
      }
      if (token.type === 'paragraph_open' && token.level === 0 && episodeId) {
        if (pendingStart) {
          for (const illustration of options.images[episodeId] || []) {
            if (illustration.position.start) append(illustration)
          }
          pendingStart = false
        }
        for (const illustration of options.images[episodeId] || []) {
          if (illustration.position.beforeParagraph === state.tokens[index + 1]?.content) append(illustration)
        }
      }
      tokens.push(token)
    })
    state.tokens = tokens
  })
  md.renderer.rules.episode_illustration = (tokens, index) => {
    const { illustration: image, first } = tokens[index].meta as { illustration: Illustration; first: boolean }
    const base = options.base.endsWith('/') ? options.base : `${options.base}/`
    const url = (src: string) => base + src.replace(/^\//, '')
    // Vue must keep public URLs literal instead of importing a base-prefixed srcset.
    const binding = (value: string) => md.utils.escapeHtml(JSON.stringify(value))
    const largest = image.sources.at(-1)!
    const srcset = image.sources.map(source => `${url(source.src)} ${source.width}w`).join(', ')
    const sizes = '(min-width: 680px) 632px, (max-width: 360px) calc(100vw - 40px), calc(100vw - 48px)'
    const webp = image.webpSources?.length
      ? `<source type="image/webp" :srcset="${binding(image.webpSources.map(source => `${url(source.src)} ${source.width}w`).join(', '))}" sizes="${sizes}">`
      : ''
    return `<figure class="episode-illustration" data-illustration="${md.utils.escapeHtml(image.id)}"><picture>${webp}<img :src="${binding(url(largest.src))}" :srcset="${binding(srcset)}" sizes="${sizes}" width="${image.width}" height="${image.height}" alt="${md.utils.escapeHtml(image.alt)}" loading="${first ? 'eager' : 'lazy'}" decoding="async"${first ? ' fetchpriority="high"' : ''}></picture></figure>\n`
  }
}
