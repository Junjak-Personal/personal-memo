/**
 * 이모지 (`:` 메뉴) — nuxt-ui-templates/editor 의 useEditorEmojis 를 옮겼다.
 * 마크다운에는 `:rocket:` 이 아니라 🚀 글자 그대로 쓴다 — 단축코드는 CommonMark 문법이 아니다.
 * 읽을 때는 다른 도구가 쓴 `:rocket:` 도 받는다 (깃허브 이모지 이름일 때만).
 */
import type { EditorEmojiMenuItem } from '@nuxt/ui'
import { Emoji, gitHubEmojis, shortcodeToEmoji } from '@tiptap/extension-emoji'

export const emojiItems: EditorEmojiMenuItem[] = gitHubEmojis.filter((emoji) => !emoji.name.startsWith('regional_indicator_'))

export const MemoEmoji = Emoji.extend({
  markdownTokenName: 'emoji',
  markdownTokenizer: {
    name: 'emoji',
    level: 'inline',
    start: ':',
    tokenize(src) {
      const match = src.match(/^:([a-zA-Z0-9_+-]+):/)
      if (!match?.[1] || !shortcodeToEmoji(match[1], gitHubEmojis)) return undefined
      return { type: 'emoji', raw: match[0], name: match[1] }
    },
  },
  parseMarkdown(token, { createNode }) {
    return createNode('emoji', { name: token.name })
  },
  renderMarkdown(node) {
    const name = node.attrs?.name
    if (typeof name !== 'string') return ''
    return shortcodeToEmoji(name, gitHubEmojis)?.emoji ?? `:${name}:`
  },
})
