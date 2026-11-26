import type { Editor } from '@tiptap/core'

type MarkedInstance = NonNullable<Editor['markdown']>['instance']

// Sticky matches can validate consecutive complete paragraphs without rescanning a malformed block.
const plainHtmlParagraph = /<p>[^<]*(?:<\/?(?:strong|em|u|del|code)>[^<]*)*<\/p>[ \t\n]*/gy
const unescapedDollar = /(?<![\\$])(?:\\\\)*/.source
const displayMath = /\$\$(?!\$)[^\\$]*(?:(?:\\[\s\S]|\$(?!\$))[^\\$]*)*\$\$(?!\$)/.source
const inlineMath = /\$(?![\s$])[^\\$\r\n]*(?:\\[^\r\n][^\\$\r\n]*)*(?<![\s$])\$(?![$\d])/.source
const dollarMath = new RegExp(`${unescapedDollar}(${displayMath}|${inlineMath})`, 'g')

function renderedMarkdown(instance: MarkedInstance, markdown: string) {
  // Marked does not recognize footnotes, so they can render identically after being escaped.
  if (/\[\^[^\]\r\n]*\]/.test(markdown)) return null

  // Tiptap registers editor-specific tokenizers on this instance.
  const defaults = instance.getDefaults()
  const tokens = instance.lexer(markdown, defaults)
  if (Object.keys(tokens.links).length > 0) return null

  const code: [language: string | undefined, text: string][] = []
  const escapes: string[] = []
  const strikethrough: string[] = []
  instance.walkTokens(tokens, token => {
    if (token.type === 'code') {
      const language: unknown = token.lang
      const text: unknown = token.text
      if ((language !== undefined && typeof language !== 'string') || typeof text !== 'string') {
        throw new Error('Invalid Markdown code token')
      }
      code.push([language, text])
    } else if (token.type === 'escape' && /^\\[\[\]<>]$/.test(token.raw)) {
      escapes.push(token.raw)
    } else if (token.type === 'del') {
      // Some Markdown renderers treat a single tilde as subscript syntax.
      strikethrough.push(token.raw.startsWith('~~') ? '~~' : '~')
    } else if (
      token.type === 'html' && token.block === false &&
      'inRawBlock' in token && token.inRawBlock === false &&
      /^<br(?:[ \t]*\/)?>$/i.test(token.raw)
    ) {
      token.text = '<br>'
    } else if (token.type === 'html' && token.block === true && token.raw.replace(plainHtmlParagraph, '') === '') {
      // The default renderer ends a paragraph with one newline. A raw block absorbs the blank line after it.
      token.text = token.raw.trimEnd() + '\n'
    }
  })

  // HTML can hide spelling differences that other Markdown renderers interpret as syntax.
  const math = Array.from(markdown.matchAll(dollarMath), ([, span]) => span)
  return JSON.stringify([instance.parser(tokens, defaults), code, escapes, strikethrough, math])
}

export function equivalentEditorMarkdown(instance: MarkedInstance, source: string, roundTrip: string): boolean {
  try {
    const original = renderedMarkdown(instance, source)
    return original !== null && original === renderedMarkdown(instance, roundTrip)
  } catch {
    return false
  }
}
