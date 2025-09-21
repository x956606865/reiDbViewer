const AMPERSAND = /&/g
const LT = /</g

const AMPERSAND_ESCAPE = '&amp;'
const LT_ESCAPE = '&lt;'

/**
 * Minimal HTML escape to prevent raw tag injection while keeping Markdown features intact.
 */
export function sanitizeMarkdownText(input: string): string {
  if (!input) return ''
  let output = input.replace(AMPERSAND, AMPERSAND_ESCAPE)
  output = output.replace(LT, LT_ESCAPE)
  return output
}

export const __test__ = {
  sanitizeMarkdownText,
}
