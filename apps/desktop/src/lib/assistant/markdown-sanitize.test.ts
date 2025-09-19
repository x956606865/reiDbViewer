import { describe, expect, it } from 'vitest'
import { __test__ } from './markdown-sanitize'

describe('sanitizeMarkdownText', () => {
  const sanitize = __test__.sanitizeMarkdownText

  it('returns empty string when input falsy', () => {
    expect(sanitize('')).toBe('')
  })

  it('escapes angle brackets but keeps markdown syntax', () => {
    expect(sanitize('**bold** <script>alert(1)</script>')).toBe('**bold** &lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes ampersands once', () => {
    expect(sanitize('Use & operators')).toBe('Use &amp; operators')
  })

  it('does not clobber blockquote markdown', () => {
    expect(sanitize('> Quote line')).toBe('> Quote line')
  })
})
