// Utilities for handling SQL templates with named variables like {{varName}}
// This compiles to parameterized SQL ($1, $2, ...) and returns a values array.

import { z } from 'zod'
import type { SavedQueryVariableDef } from '@rei-db-view/types/appdb'

export const VarValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.date(),
  z.null(),
  z.any(),
])

const varNameRe = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

// --- Template AST -----------------------------------------------------------------

type TemplateNode = TextNode | VarNode | WhenBlock | IfBlock

type TextNode = { type: 'text'; value: string }
type VarNode = { type: 'var'; name: string }
type WhenBlock = {
  type: 'when'
  vars: string[]
  body: TemplateNode[]
  elseBody?: TemplateNode[]
}
type IfBlock = {
  type: 'if'
  expr: ExpressionNode
  body: TemplateNode[]
  elseBody?: TemplateNode[]
}

type BlockNode = WhenBlock | IfBlock

type BlockFrame = {
  node: BlockNode
  inElse: boolean
}

// --- Expression AST ----------------------------------------------------------------

type ExpressionNode =
  | { type: 'literal'; value: any }
  | { type: 'variable'; name: string }
  | { type: 'unary'; op: '!'; argument: ExpressionNode }
  | { type: 'binary'; op: BinaryOperator; left: ExpressionNode; right: ExpressionNode }
  | { type: 'in'; value: ExpressionNode; options: ExpressionNode[] }
  | { type: 'call'; callee: 'presence'; args: ExpressionNode[] }

type BinaryOperator = '&&' | '||' | '==' | '!=' | '>' | '>=' | '<' | '<='

type ExprToken =
  | { type: 'identifier'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }
  | { type: 'operator'; value: BinaryOperator | '!' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'lbracket' }
  | { type: 'rbracket' }
  | { type: 'comma' }
  | { type: 'keyword'; value: 'in' }

// --- Core helpers -------------------------------------------------------------------

// Remove single-line and block comments and single-quoted literals to reduce false-positive placeholder matches
function stripStringsAndComments(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const ch2 = sql.slice(i, i + 2)
    if (ch2 === '--') {
      const nl = sql.indexOf('\n', i + 2)
      i = nl === -1 ? sql.length : nl
      out += '\n'
      continue
    }
    if (ch2 === '/*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
      continue
    }
    if (ch === "'") {
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i - 1] !== '\\') {
          i++
          break
        }
        i++
      }
      out += "''"
      continue
    }
    out += ch
    i++
  }
  return out
}

function tokenizeTemplate(template: string): Array<{ type: 'text' | 'tag'; value: string; start: number }> {
  const tokens: Array<{ type: 'text' | 'tag'; value: string; start: number }> = []
  let cursor = 0
  while (cursor < template.length) {
    const open = template.indexOf('{{', cursor)
    if (open === -1) {
      tokens.push({ type: 'text', value: template.slice(cursor), start: cursor })
      break
    }
    if (open > cursor) {
      tokens.push({ type: 'text', value: template.slice(cursor, open), start: cursor })
    }
    const close = template.indexOf('}}', open + 2)
    if (close === -1) {
      throw new Error(`Unclosed tag starting at position ${open}`)
    }
    const raw = template.slice(open + 2, close)
    tokens.push({ type: 'tag', value: raw, start: open })
    cursor = close + 2
  }
  return tokens
}

function parseTemplate(template: string): TemplateNode[] {
  const tokens = tokenizeTemplate(template)
  const root: TemplateNode[] = []
  const stack: BlockFrame[] = []

  const currentNodes = (): TemplateNode[] => {
    if (stack.length === 0) return root
    const top = stack[stack.length - 1]!
    if (top.inElse) {
      if (!top.node.elseBody) top.node.elseBody = []
      return top.node.elseBody
    }
    return top.node.body
  }

  for (const token of tokens) {
    const bucket = currentNodes()
    if (token.type === 'text') {
      if (token.value.length > 0) bucket.push({ type: 'text', value: token.value })
      continue
    }

    const content = token.value.trim()
    if (content === '') continue

    if (content.startsWith('#')) {
      const spaceIdx = content.indexOf(' ')
      const directive = spaceIdx === -1 ? content : content.slice(0, spaceIdx)
      const rest = spaceIdx === -1 ? '' : content.slice(spaceIdx + 1).trim()
      if (directive === '#when') {
        if (!rest) throw new Error('`#when` requires at least one variable name')
        const vars = rest.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
        if (vars.length === 0) throw new Error('`#when` requires at least one variable name')
        const node: WhenBlock = { type: 'when', vars, body: [] }
        bucket.push(node)
        stack.push({ node, inElse: false })
        continue
      }
      if (directive === '#if') {
        if (!rest) throw new Error('`#if` requires a condition expression')
        const expr = parseConditionExpression(rest)
        const node: IfBlock = { type: 'if', expr, body: [] }
        bucket.push(node)
        stack.push({ node, inElse: false })
        continue
      }
      throw new Error(`Unknown block directive: ${directive}`)
    }

    if (content === 'else') {
      const frame = stack[stack.length - 1]
      if (!frame) throw new Error('`else` found without an open block')
      if (frame.inElse) throw new Error('Multiple `else` clauses are not allowed')
      frame.inElse = true
      if (!frame.node.elseBody) frame.node.elseBody = []
      continue
    }

    if (content.startsWith('/')) {
      const name = content.slice(1).trim()
      const frame = stack.pop()
      if (!frame) throw new Error(`Unmatched closing block: /${name}`)
      if (frame.node.type !== name) {
        throw new Error(`Closing block /${name} does not match opening ${frame.node.type}`)
      }
      continue
    }

    // plain variable
    const varName = content
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
      throw new Error(`Unsupported tag: {{${content}}}`)
    }
    bucket.push({ type: 'var', name: varName })
  }

  if (stack.length > 0) {
    const open = stack[stack.length - 1]!
    throw new Error(`Unclosed block: ${open.node.type}`)
  }

  return root
}

interface RenderContext {
  hasVariable(name: string): boolean
  getValue(name: string): any
  presenceOf(name: string): boolean
}

function renderTemplate(nodes: TemplateNode[], ctx: RenderContext): string {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value
        break
      case 'var':
        if (!ctx.hasVariable(node.name)) {
          throw new Error(`Undefined variable: ${node.name}`)
        }
        out += `{{${node.name}}}`
        break
      case 'when': {
        const branch = node.vars.every(v => {
          if (!ctx.hasVariable(v)) throw new Error(`Undefined variable: ${v}`)
          return ctx.presenceOf(v)
        })
          ? node.body
          : node.elseBody
        if (branch) out += renderTemplate(branch, ctx)
        break
      }
      case 'if': {
        const result = evaluateExpression(node.expr, ctx)
        const branch = result ? node.body : node.elseBody
        if (branch) out += renderTemplate(branch, ctx)
        break
      }
      default:
        break
    }
  }
  return out
}

function collapseWhitespace(sql: string): string {
  const withoutTrailing = sql.replace(/[ \t]+\n/g, '\n')
  return withoutTrailing.replace(/\n{3,}/g, '\n\n')
}

function computePresence(value: any): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

function evaluateExpression(expr: ExpressionNode, ctx: RenderContext): boolean {
  const evalNode = (node: ExpressionNode): any => {
    if (node.type === 'literal') {
      return node.value
    }
    if (node.type === 'variable') {
      if (!ctx.hasVariable(node.name)) throw new Error(`Undefined variable: ${node.name}`)
      return ctx.getValue(node.name)
    }
    if (node.type === 'unary') {
      const unaryNode = node as Extract<ExpressionNode, { type: 'unary' }>
      if (unaryNode.op !== '!') {
        throw new Error(`Unsupported unary operator: ${unaryNode.op}`)
      }
      return !toBoolean(evalNode(unaryNode.argument))
    }
    if (node.type === 'binary') {
      return evaluateBinary(node.op, evalNode(node.left), evalNode(node.right))
    }
    if (node.type === 'in') {
      const left = evalNode(node.value)
      return node.options.some((opt) => valueEquals(evalNode(opt), left))
    }
    if (node.type === 'call') {
      if (node.callee !== 'presence') {
        throw new Error(`Unsupported function: ${node.callee}`)
      }
      if (node.args.length !== 1) throw new Error('presence() expects exactly one argument')
      const arg = node.args[0]
      if (!arg || arg.type !== 'variable') {
        throw new Error('presence() argument must be a variable name')
      }
      const target = arg.name
      if (!ctx.hasVariable(target)) throw new Error(`Undefined variable: ${target}`)
      return ctx.presenceOf(target)
    }
    throw new Error(`Unsupported expression node: ${(node as any).type ?? 'unknown'}`)
  }
  return toBoolean(evalNode(expr))
}

function evaluateBinary(op: BinaryOperator, left: any, right: any): boolean {
  switch (op) {
    case '&&':
      return toBoolean(left) && toBoolean(right)
    case '||':
      return toBoolean(left) || toBoolean(right)
    case '==':
      return valueEquals(left, right)
    case '!=':
      return !valueEquals(left, right)
    case '>':
      return toComparable(left) > toComparable(right)
    case '>=':
      return toComparable(left) >= toComparable(right)
    case '<':
      return toComparable(left) < toComparable(right)
    case '<=':
      return toComparable(left) <= toComparable(right)
    default:
      throw new Error(`Unsupported binary operator: ${op}`)
  }
}

function toBoolean(val: any): boolean {
  return !!val
}

function toComparable(val: any): any {
  if (val instanceof Date) return val.getTime()
  return val
}

function valueEquals(a: any, b: any): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  return a === b
}

// --- Expression parsing -------------------------------------------------------------

function parseConditionExpression(input: string): ExpressionNode {
  const tokens = tokenizeExpression(input)
  let pos = 0

  const peek = (): ExprToken | undefined => tokens[pos]
  const consume = (): ExprToken => {
    const token = tokens[pos]
    if (!token) throw new Error('Unexpected end of expression')
    pos++
    return token
  }
  const match = <T extends ExprToken["type"]>(type: T, value?: any): boolean => {
    const token = tokens[pos]
    if (!token || token.type !== type) return false
    if (value !== undefined) {
      if ((token as any).value !== value) return false
    }
    pos++
    return true
  }
  const expect = <T extends ExprToken["type"]>(type: T, value?: any): ExprToken => {
    const token = consume()
    if (token.type !== type || (value !== undefined && (token as any).value !== value)) {
      throw new Error(`Unexpected token in expression`)
    }
    return token
  }

  const parseExpressionInternal = (): ExpressionNode => parseOr()

  const parseOr = (): ExpressionNode => {
    let node = parseAnd()
    while (match('operator', '||')) {
      node = { type: 'binary', op: '||', left: node, right: parseAnd() }
    }
    return node
  }

  const parseAnd = (): ExpressionNode => {
    let node = parseEquality()
    while (match('operator', '&&')) {
      node = { type: 'binary', op: '&&', left: node, right: parseEquality() }
    }
    return node
  }

  const parseEquality = (): ExpressionNode => {
    let node = parseRelational()
    while (true) {
      if (match('operator', '==')) {
        node = { type: 'binary', op: '==', left: node, right: parseRelational() }
        continue
      }
      if (match('operator', '!=')) {
        node = { type: 'binary', op: '!=', left: node, right: parseRelational() }
        continue
      }
      break
    }
    return node
  }

  const parseRelational = (): ExpressionNode => {
    let node = parseIn()
    while (true) {
      if (match('operator', '>')) {
        node = { type: 'binary', op: '>', left: node, right: parseIn() }
        continue
      }
      if (match('operator', '>=')) {
        node = { type: 'binary', op: '>=', left: node, right: parseIn() }
        continue
      }
      if (match('operator', '<')) {
        node = { type: 'binary', op: '<', left: node, right: parseIn() }
        continue
      }
      if (match('operator', '<=')) {
        node = { type: 'binary', op: '<=', left: node, right: parseIn() }
        continue
      }
      break
    }
    return node
  }

  const parseIn = (): ExpressionNode => {
    let node = parseUnary()
    if (match('keyword', 'in')) {
      node = { type: 'in', value: node, options: parseArrayLiteral() }
    }
    return node
  }

  const parseUnary = (): ExpressionNode => {
    if (match('operator', '!')) {
      return { type: 'unary', op: '!', argument: parseUnary() }
    }
    return parsePrimary()
  }

  const parsePrimary = (): ExpressionNode => {
    const token = peek()
    if (!token) throw new Error('Unexpected end of expression')
    if (token.type === 'identifier') {
      const ident = consume() as Extract<ExprToken, { type: 'identifier' }>
      if (match('lparen')) {
        const args: ExpressionNode[] = []
        if (!match('rparen')) {
          args.push(parseExpressionInternal())
          while (match('comma')) {
            args.push(parseExpressionInternal())
          }
          expect('rparen')
        }
        if (ident.value !== 'presence') {
          throw new Error(`Unsupported function: ${ident.value}`)
        }
        return { type: 'call', callee: 'presence', args }
      }
      return { type: 'variable', name: ident.value }
    }
    if (token.type === 'number') {
      const lit = consume() as Extract<ExprToken, { type: 'number' }>
      return { type: 'literal', value: lit.value }
    }
    if (token.type === 'string') {
      const lit = consume() as Extract<ExprToken, { type: 'string' }>
      return { type: 'literal', value: lit.value }
    }
    if (token.type === 'boolean') {
      const lit = consume() as Extract<ExprToken, { type: 'boolean' }>
      return { type: 'literal', value: lit.value }
    }
    if (token.type === 'null') {
      consume()
      return { type: 'literal', value: null }
    }
    if (match('lparen')) {
      const expr = parseExpressionInternal()
      expect('rparen')
      return expr
    }
    throw new Error('Unexpected token in expression')
  }

  const parseArrayLiteral = (): ExpressionNode[] => {
    expect('lbracket')
    const items: ExpressionNode[] = []
    if (match('rbracket')) return items
    while (true) {
      const next = peek()
      if (!next) throw new Error('Unexpected end in array literal')
      if (next.type === 'string' || next.type === 'number' || next.type === 'boolean' || next.type === 'null') {
        const lit = consume()
        items.push(
          lit.type === 'null'
            ? { type: 'literal', value: null }
            : { type: 'literal', value: (lit as any).value },
        )
      } else {
        throw new Error('Array literals only support primitive constants')
      }
      if (match('comma')) continue
      expect('rbracket')
      break
    }
    return items
  }

  const expr = parseExpressionInternal()
  if (pos < tokens.length) {
    throw new Error('Unexpected trailing tokens in expression')
  }
  return expr
}

function tokenizeExpression(input: string): ExprToken[] {
  const tokens: ExprToken[] = []
  let i = 0
  const len = input.length

  const isIdentifierStart = (c: string) => /[a-zA-Z_]/.test(c)
  const isIdentifierPart = (c: string) => /[a-zA-Z0-9_]/.test(c)

  const charAt = (index: number) => input.charAt(index)

  while (i < len) {
    const ch = charAt(i)
    if (!ch) break
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      i += 1
      let value = ''
      let closed = false
      while (i < len) {
        const c = charAt(i)
        if (c === '\\') {
          const next = charAt(i + 1)
          if (!next) throw new Error('Invalid escape sequence in string literal')
          value += next
          i += 2
          continue
        }
        if (c === quote) {
          closed = true
          i += 1
          break
        }
        value += c
        i += 1
      }
      if (!closed) throw new Error('Unterminated string literal')
      tokens.push({ type: 'string', value })
      continue
    }
    const nextChar = charAt(i + 1)
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(nextChar))) {
      const start = i
      i += 1
      while (i < len) {
        const digit = charAt(i)
        if (!/[0-9]/.test(digit)) break
        i += 1
      }
      if (charAt(i) === '.') {
        i += 1
        while (i < len) {
          const digit = charAt(i)
          if (!/[0-9]/.test(digit)) break
          i += 1
        }
      }
      const raw = input.slice(start, i)
      const num = Number(raw)
      if (!Number.isFinite(num)) throw new Error(`Invalid number literal: ${raw}`)
      tokens.push({ type: 'number', value: num })
      continue
    }
    if (ch === '&' && nextChar === '&') {
      tokens.push({ type: 'operator', value: '&&' })
      i += 2
      continue
    }
    if (ch === '|' && nextChar === '|') {
      tokens.push({ type: 'operator', value: '||' })
      i += 2
      continue
    }
    if (ch === '=' && nextChar === '=') {
      tokens.push({ type: 'operator', value: '==' })
      i += 2
      continue
    }
    if (ch === '!' && nextChar === '=') {
      tokens.push({ type: 'operator', value: '!=' })
      i += 2
      continue
    }
    if (ch === '!') {
      tokens.push({ type: 'operator', value: '!' })
      i += 1
      continue
    }
    if (ch === '>' && nextChar === '=') {
      tokens.push({ type: 'operator', value: '>=' })
      i += 2
      continue
    }
    if (ch === '<' && nextChar === '=') {
      tokens.push({ type: 'operator', value: '<=' })
      i += 2
      continue
    }
    if (ch === '>') {
      tokens.push({ type: 'operator', value: '>' })
      i += 1
      continue
    }
    if (ch === '<') {
      tokens.push({ type: 'operator', value: '<' })
      i += 1
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' })
      i += 1
      continue
    }
    if (ch === '[') {
      tokens.push({ type: 'lbracket' })
      i += 1
      continue
    }
    if (ch === ']') {
      tokens.push({ type: 'rbracket' })
      i += 1
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' })
      i += 1
      continue
    }
    if (isIdentifierStart(ch)) {
      let ident = ch
      i += 1
      while (i < len) {
        const part = charAt(i)
        if (!isIdentifierPart(part)) break
        ident += part
        i += 1
      }
      if (ident === 'true') {
        tokens.push({ type: 'boolean', value: true })
        continue
      }
      if (ident === 'false') {
        tokens.push({ type: 'boolean', value: false })
        continue
      }
      if (ident === 'null') {
        tokens.push({ type: 'null' })
        continue
      }
      if (ident === 'in') {
        tokens.push({ type: 'keyword', value: 'in' })
        continue
      }
      tokens.push({ type: 'identifier', value: ident })
      continue
    }
    throw new Error(`Unexpected character in expression: ${ch}`)
  }
  return tokens
}

// --- Public API --------------------------------------------------------------------

export function extractVarNames(sql: string): string[] {
  const cleaned = stripStringsAndComments(sql)
  try {
    const ast = parseTemplate(cleaned)
    const names = new Set<string>()
    const visit = (nodes: TemplateNode[]) => {
      for (const node of nodes) {
        if (node.type === 'var') {
          names.add(node.name)
        } else if (node.type === 'when' || node.type === 'if') {
          visit(node.body)
          if (node.elseBody) visit(node.elseBody)
        }
      }
    }
    visit(ast)
    return Array.from(names)
  } catch {
    const names = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = varNameRe.exec(cleaned))) {
      const candidate = m[1]
      if (candidate && candidate !== 'else') names.add(candidate)
    }
    return Array.from(names)
  }
}

export type CompiledSql = { text: string; values: any[]; placeholders: string[] }

export function isReadOnlySelect(sql: string): boolean {
  const t = stripStringsAndComments(sql).trim().toLowerCase()
  if (t.startsWith('with ') || t.startsWith('select ')) return true
  return false
}

export function compileSql(
  sql: string,
  vars: SavedQueryVariableDef[],
  input: Record<string, unknown>,
): CompiledSql {
  const byName = new Map<string, SavedQueryVariableDef>()
  for (const v of vars) byName.set(v.name, v)

  const resolvedValues = new Map<string, any>()
  for (const v of vars) {
    const hasInput = Object.prototype.hasOwnProperty.call(input, v.name)
    const rawValue = hasInput ? input[v.name] : undefined
    resolvedValues.set(v.name, normalizeValue(v.name, v, rawValue, hasInput))
  }

  const ast = parseTemplate(sql)
  const rendered = collapseWhitespace(
    renderTemplate(ast, {
      hasVariable: name => byName.has(name),
      getValue: name => resolvedValues.get(name),
      presenceOf: name => computePresence(resolvedValues.get(name)),
    }),
  )

  const placeholders: string[] = []
  const values: any[] = []
  const used = new Map<string, number>()

  const text = rendered.replace(varNameRe, (_, raw: string) => {
    const name = String(raw)
    if (!byName.has(name)) throw new Error(`Undefined variable: ${name}`)
    const def = byName.get(name)!
    const val = resolvedValues.get(name)
    if (def.type === 'raw') {
      return String(val ?? '')
    }
    if (used.has(name)) return `$${used.get(name)}`
    values.push(val)
    const idx = values.length
    placeholders.push(name)
    used.set(name, idx)
    return `$${idx}`
  })

  return { text, values, placeholders }
}

// Render a human-friendly SQL string by inlining parameter values into the compiled SQL.
// This is ONLY for preview purposes.
export function renderSqlPreview(compiled: CompiledSql, vars: SavedQueryVariableDef[]): string {
  const defByName = new Map(vars.map(v => [v.name, v] as const))
  const { text, values, placeholders } = compiled
  const esc = (s: string) => s.replaceAll("'", "''")
  const fmtDate = (d: Date) => {
    const z = new Date(d)
    const yyyy = z.getUTCFullYear()
    const mm = String(z.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(z.getUTCDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const fmt = (name: string | undefined, val: any): string => {
    if (val === null || val === undefined) return 'NULL'
    const def = name ? defByName.get(name) : undefined
    const t = def?.type
    switch (t) {
      case 'number':
        return String(val)
      case 'boolean':
        return val ? 'TRUE' : 'FALSE'
      case 'date':
        return `'${fmtDate(val instanceof Date ? val : new Date(String(val)))}'::date`
      case 'timestamp':
        return `'${(val instanceof Date ? val : new Date(String(val))).toISOString()}'::timestamptz`
      case 'json': {
        const json = typeof val === 'string' ? val : JSON.stringify(val)
        return `'${esc(json)}'::jsonb`
      }
      case 'enum':
        return `'${esc(String(val))}'`
      case 'uuid':
      case 'text':
      default:
        return `'${esc(String(val))}'`
    }
  }

  return text.replace(/\$(\d+)/g, (_m, g1) => {
    const idx = Number(g1) - 1
    const name = placeholders[idx]
    const val = values[idx]
    return fmt(name, val)
  })
}

function normalizeValue(
  name: string,
  def: SavedQueryVariableDef,
  raw: unknown,
  provided: boolean,
): any {
  const required = !!def.required
  const type = def.type
  const hasDefault = def.default !== undefined

  if (!provided || raw === undefined) {
    if (hasDefault) return def.default
    if (required) throw new Error(`Variable ${name} is required`)
    return null
  }

  if (raw === null || raw === '') {
    if (required) throw new Error(`Variable ${name} is required`)
    return null
  }
  switch (type) {
    case 'text':
      return String(raw)
    case 'uuid':
      return String(raw)
    case 'enum': {
      const v = String(raw)
      if (Array.isArray(def.options) && def.options.length > 0) {
        if (!def.options.includes(v)) {
          throw new Error(`Variable ${name} must be one of: ${def.options.join(', ')}`)
        }
      }
      return v
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) throw new Error(`Variable ${name} must be a number`)
      return n
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      if (raw === 'true' || raw === '1' || raw === 1) return true
      if (raw === 'false' || raw === '0' || raw === 0) return false
      throw new Error(`Variable ${name} must be a boolean`)
    case 'date': {
      const d = raw instanceof Date ? raw : new Date(String(raw))
      if (Number.isNaN(d.getTime())) throw new Error(`Variable ${name} must be a date`)
      return d
    }
    case 'timestamp': {
      const d = raw instanceof Date ? raw : new Date(String(raw))
      if (Number.isNaN(d.getTime())) throw new Error(`Variable ${name} must be a timestamp`)
      return d
    }
    case 'json': {
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw)
        } catch {
          throw new Error(`Variable ${name} must be valid JSON`)
        }
      }
      return raw
    }
    case 'raw':
      return String(raw)
    default:
      return raw
  }
}

export const __test__ = {
  stripStringsAndComments,
  extractVarNames,
  normalizeValue,
  parseTemplate,
  tokenizeExpression,
}
