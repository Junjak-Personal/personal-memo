import type { AnyExtension } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import type { ImageOptions } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Underline from '@tiptap/extension-underline'
import { CodeBlockShiki } from 'tiptap-extension-code-block-shiki'
import { MemoEmoji } from './editor-emoji'
import { memoTableKit } from './editor-table'
import { MemoReference } from './memo-reference'
import type { MemoReferenceOptions } from './memo-reference'

/**
 * 밑줄 — 마크다운에는 `<u>text</u>` 로 쓴다.
 *
 * Tiptap 기본은 `++text++` 인데 CommonMark/GFM 문법이 아니라 다른 도구에서 `++` 가 그대로 보인다.
 * 기본 토크나이저는 `C++ 와 C++` 같은 평문도 밑줄로 읽는다.
 *
 * 🔴 `<u>` 를 인라인 HTML 로 읽게 두면 안 된다. 그러면 안쪽 `**굵게**` 가 마크다운이 아니라
 *    글자로 들어오고, 저장할 때마다 `\*\*` → `\\\*\\\*` 로 역슬래시가 불어난다 (스파이크 S2 실측).
 *    그래서 `<u>…</u>` 를 직접 토큰으로 잘라 안쪽을 인라인 마크다운으로 다시 읽는다.
 */
export const HtmlUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`
  },
  markdownTokenizer: {
    name: 'underline',
    level: 'inline',
    start: (src) => src.indexOf('<u>'),
    tokenize(src, _tokens, lexer) {
      const match = /^<u>([\s\S]+?)<\/u>/.exec(src)
      if (!match) return undefined
      const inner = match[1]!
      return { type: 'underline', raw: match[0], text: inner, tokens: lexer.inlineTokens(inner) }
    },
  },
})

interface MemoImageOptions extends ImageOptions {
  /** 본문 속 상대경로 → 화면 주소 */
  toDisplay: (src: string) => string
  /** 화면 주소 → 본문 속 경로 (복사·붙여넣기로 HTML 을 거쳐 돌아올 때) */
  toStored: (src: string) => string
}

/**
 * 이미지 — 노드 속성에는 본문 속 상대경로를 그대로 두고, 그릴 때만 화면 주소로 바꾼다.
 *
 * renderMarkdown 은 노드 속성(src)을 그대로 쓰므로 저장되는 마크다운에 서버 주소가 섞이지 않는다.
 * 클립보드는 renderHTML 결과(화면 주소)를 담으므로, 붙여넣을 때 parseHTML 에서 되돌린다.
 */
export const MemoImage = Image.extend<MemoImageOptions>({
  addOptions() {
    return {
      ...this.parent!(),
      toDisplay: (src: string) => src,
      toStored: (src: string) => src,
    }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('src')
          return raw ? this.options.toStored(raw) : null
        },
        renderHTML: (attrs) => ({
          src: typeof attrs.src === 'string' ? this.options.toDisplay(attrs.src) : null,
        }),
      },
    }
  },
})

/**
 * 메모 본문을 읽고 그리는 확장 — 편집기(MemoDocument)와 외부 공개 화면(/ext)이 같은 것을 쓴다. 둘이 다르면 같은 마크다운이
 * 다르게 보인다. editOnly 는 편집기만 쓰는 것(이미지 올리기 자리표시)이고, 원래 순서대로 이미지 앞에 둔다.
 */
export function memoExtensions(image: Pick<MemoImageOptions, 'toDisplay' | 'toStored'>, editOnly: AnyExtension[] = [], reference: Partial<MemoReferenceOptions> = {}): AnyExtension[] {
  return [
    HtmlUnderline,
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node, checked) => `${checked ? '완료' : '할 일'}: ${node.textContent || '빈 항목'}` },
    }),
    memoTableKit(),
    CodeBlockShiki.configure({
      defaultTheme: 'material-theme',
      themes: { light: 'material-theme-lighter', dark: 'material-theme-palenight' },
    }),
    MemoEmoji,
    MemoReference.configure(reference),
    ...editOnly,
    MemoImage.configure(image),
  ]
}
