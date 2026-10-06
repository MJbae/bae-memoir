import type { MarkdownOptions } from 'vitepress'
import { parseEpisodeHeading } from '../shared/episode-heading.mjs'
type Markdown = Parameters<NonNullable<MarkdownOptions['config']>>[0]

export function episodeComments(md: Markdown, options: { base: string; enabled: boolean }) {
  if (!options.enabled) return
  md.core.ruler.after('inline', 'episode_comments', (state) => {
    if (state.env.frontmatter?.kind !== 'full') return
    const tokens: typeof state.tokens = []
    let episode: ReturnType<typeof parseEpisodeHeading> = null
    const append = () => {
      if (!episode) return
      const token = new state.Token('episode_comments', '', 0)
      token.block = true
      token.meta = episode
      tokens.push(token)
      episode = null
    }
    state.tokens.forEach((token, index) => {
      if (token.type === 'heading_open' && token.level === 0) {
        if (['h1', 'h2'].includes(token.tag)) append()
        if (token.tag === 'h2') episode = parseEpisodeHeading(state.tokens[index + 1]?.content || '')
      }
      tokens.push(token)
    })
    append()
    state.tokens = tokens
  })
  md.renderer.rules.episode_comments = (tokens, index) => {
    const { id, title } = tokens[index].meta
    const base = options.base.endsWith('/') ? options.base : `${options.base}/`
    return `<p class="episode-comments-link"><a href="${md.utils.escapeHtml(`${base}read/${id}.html#reactions`)}">${md.utils.escapeHtml(title)} 반응·댓글</a></p>\n`
  }
}
