import type * as monacoEditor from 'monaco-editor'
import {
  ensureSchemaMetadataForConnection,
  formatIdentifierIfNeeded,
  getSchemaMetadataSnapshot,
  normalizeIdentifierForLookup,
  type SchemaMetadataSnapshot,
  type SchemaMetadataTable,
} from '@/lib/schema-metadata-store'

const TABLE_CONTEXT_KEYWORDS = new Set(['from', 'join', 'update', 'into', 'table'])

const SQL_KEYWORDS = [
  'select',
  'from',
  'where',
  'group by',
  'having',
  'order by',
  'limit',
  'offset',
  'with',
  'insert',
  'update',
  'delete',
  'on',
  'inner join',
  'left join',
  'right join',
  'full join',
  'cross join',
  'distinct',
  'union',
  'intersect',
  'except',
  'case',
  'when',
  'then',
  'else',
  'end',
]

const IDENTIFIER_FRAGMENT = String.raw`(?:"(?:""|[^"])*(?:"|$)|[a-zA-Z_][\w$]*)`
const IDENTIFIER_TRIGGER_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$_'
const TRIGGER_CHARACTERS = Array.from(new Set([' ', '.', '"', ...IDENTIFIER_TRIGGER_CHARS.split('')]))
const COLUMN_CONTEXT_REGEX = new RegExp(
  String.raw`(?:(?<schema>${IDENTIFIER_FRAGMENT})\s*\.)?(?<table>${IDENTIFIER_FRAGMENT})\s*\.(?<prefix>${IDENTIFIER_FRAGMENT})?$`,
)
const TABLE_QUALIFIER_REGEX = new RegExp(
  String.raw`(?<schema>${IDENTIFIER_FRAGMENT})\s*\.(?<prefix>${IDENTIFIER_FRAGMENT})?$`,
)

let initialized = false
let disposable: monacoEditor.IDisposable | null = null

function stripQuotes(raw: string | undefined | null): string {
  const value = (raw || '').trim()
  if (!value) return ''
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/""/g, '"')
  }
  return value
}

type AliasEntry = {
  alias: string
  normalized: string
  insertAlias: string
  rawAlias?: string
  table: SchemaMetadataTable | null
}

type ContextAnalysis = {
  aliasByKey: Map<string, AliasEntry>
  aliasEntries: AliasEntry[]
}

function lookupTable(
  metadata: SchemaMetadataSnapshot,
  schemaText: string | null,
  tableText: string,
): SchemaMetadataTable | null {
  const normalizedTable = normalizeIdentifierForLookup(tableText)
  if (schemaText) {
    const key = `${normalizeIdentifierForLookup(schemaText)}.${normalizedTable}`
    const direct = metadata.tablesByKey.get(key)
    if (direct) return direct
  }
  const matches = metadata.tablesByName.get(normalizeIdentifierForLookup(tableText))
  if (!matches || matches.length === 0) return null
  if (matches.length === 1) {
    const only = matches[0]
    return only ?? null
  }
  const stripped = stripQuotes(tableText)
  const exact = matches.find((t) => t.name === stripped)
  const fallback = matches[0]
  return exact ?? fallback ?? null
}

function collectContext(model: monacoEditor.editor.ITextModel, metadata: SchemaMetadataSnapshot | null): ContextAnalysis {
  const aliasByKey = new Map<string, AliasEntry>()
  const aliasEntries: AliasEntry[] = []
  if (!metadata) return { aliasByKey, aliasEntries }

  const text = model.getValue()
  const relationRegex = /\b(from|join)\s+((?:"(?:""|[^"])*"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"(?:""|[^"])*"|[a-zA-Z_][\w$]*))?)(?:\s+(?:as\s+)?((?:"(?:""|[^"])*"|[a-zA-Z_][\w$]*)))?/gi
  let match: RegExpExecArray | null
  while ((match = relationRegex.exec(text)) != null) {
    const rawQualified = match[2]
    if (!rawQualified) continue
    const rawAlias = match[3]
    const parts = rawQualified.split('.').map((p) => p.trim()).filter(Boolean)
    const rawTable = parts.pop() ?? ''
    const rawSchema = parts.pop() ?? null
    const tableMeta = lookupTable(metadata, rawSchema, rawTable)
    const aliasSource = rawAlias || rawTable
    const aliasNormalized = normalizeIdentifierForLookup(aliasSource ?? '')
    const entry: AliasEntry = {
      alias: stripQuotes(aliasSource),
      normalized: aliasNormalized,
      insertAlias: stripQuotes(aliasSource),
      rawAlias: rawAlias ?? undefined,
      table: tableMeta,
    }
    aliasByKey.set(aliasNormalized, entry)
    aliasEntries.push(entry)
    if (tableMeta) {
      const tableKey = normalizeIdentifierForLookup(tableMeta.name)
      aliasByKey.set(tableKey, entry)
      const qualifiedKey = `${normalizeIdentifierForLookup(tableMeta.schema)}.${tableKey}`
      aliasByKey.set(qualifiedKey, entry)
    }
    if (!rawAlias && rawSchema && tableMeta) {
      const qualifiedRaw = `${normalizeIdentifierForLookup(rawSchema)}.${normalizeIdentifierForLookup(rawTable)}`
      aliasByKey.set(qualifiedRaw, entry)
    }
  }

  const cteRegex = /\b(with|,)\s+((?:"(?:""|[^"])*"|[a-zA-Z_][\w$]*))\s+as\b/gi
  while ((match = cteRegex.exec(text)) != null) {
    const rawName = match[2]
    if (!rawName) continue
    const normalized = normalizeIdentifierForLookup(rawName)
    if (!aliasByKey.has(normalized)) {
      const entry: AliasEntry = {
        alias: stripQuotes(rawName),
        normalized,
        insertAlias: stripQuotes(rawName),
        table: null,
      }
      aliasByKey.set(normalized, entry)
      aliasEntries.push(entry)
    }
  }

  return { aliasByKey, aliasEntries }
}

type ColumnContext = {
  schema?: string | null
  aliasToken: string
  prefix: string
  range: monacoEditor.IRange
}

type TableQualifierContext = {
  schema: string
  prefix: string
}

function detectColumnContext(
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
  monacoInstance: typeof monacoEditor,
): ColumnContext | null {
  const linePrefix = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  })
  const match = COLUMN_CONTEXT_REGEX.exec(linePrefix)
  if (!match || !match.groups) return null
  const schemaRaw = match.groups.schema ?? null
  const tableRaw = match.groups.table ?? ''
  const prefixRaw = match.groups.prefix ?? ''
  const range = new monacoInstance.Range(
    position.lineNumber,
    position.column - prefixRaw.length,
    position.lineNumber,
    position.column,
  )
  return {
    schema: schemaRaw,
    aliasToken: tableRaw,
    prefix: prefixRaw,
    range,
  }
}

function detectTableQualifier(fragment: string): TableQualifierContext | null {
  const trimmed = fragment.trimEnd()
  const match = TABLE_QUALIFIER_REGEX.exec(trimmed)
  if (!match?.groups) return null
  const schemaRaw = match.groups.schema
  if (!schemaRaw) return null
  const prefixRaw = match.groups.prefix ?? ''
  return {
    schema: schemaRaw,
    prefix: prefixRaw,
  }
}

function tokenize(fragment: string): string[] {
  const tokens: string[] = []
  const regex = /"(?:""|[^"])*"|[a-zA-Z_][\w$]*|[,()*]/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(fragment)) != null) {
    tokens.push(match[0])
  }
  return tokens
}

function determineContext(tokens: string[]): 'table' | 'general' {
  if (tokens.length === 0) return 'general'
  const last = tokens[tokens.length - 1]?.toLowerCase?.() ?? ''
  const prev = tokens[tokens.length - 2]?.toLowerCase?.() ?? ''
  if (TABLE_CONTEXT_KEYWORDS.has(last) || TABLE_CONTEXT_KEYWORDS.has(prev)) return 'table'
  return 'general'
}

function buildColumnSuggestions(
  table: SchemaMetadataTable,
  range: monacoEditor.IRange,
  monacoInstance: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
  const suggestions: monacoEditor.languages.CompletionItem[] = []
  for (const column of table.columns) {
    const insertText = formatIdentifierIfNeeded(column.name)
    const nullable = column.nullable === false ? 'NOT NULL' : 'nullable'
    let docValue = `**${column.dataType}** · ${nullable}`
    if (column.isPrimaryKey) {
      docValue += '\n\nPrimary key'
    }
    suggestions.push({
      label: column.name,
      kind: monacoInstance.languages.CompletionItemKind.Field,
      insertText,
      range,
      detail: column.dataType,
      documentation: { value: docValue },
      sortText: `1_${column.name}`,
    })
  }
  return suggestions
}

function buildScopedColumnSuggestions(
  analysis: ContextAnalysis,
  monacoInstance: typeof monacoEditor,
  range: monacoEditor.IRange,
): monacoEditor.languages.CompletionItem[] {
  const suggestions: monacoEditor.languages.CompletionItem[] = []
  const seen = new Set<string>()
  for (const entry of analysis.aliasEntries) {
    if (!entry.table) continue
    const aliasInsert = formatIdentifierIfNeeded(entry.insertAlias || entry.alias)
    for (const column of entry.table.columns) {
      const columnInsert = formatIdentifierIfNeeded(column.name)
      const key = `${aliasInsert}.${columnInsert}`
      if (seen.has(key)) continue
      seen.add(key)
      const nullable = column.nullable === false ? 'NOT NULL' : 'nullable'
      let docValue = `**${column.dataType}** · ${nullable}`
      if (column.isPrimaryKey) {
        docValue += '\n\nPrimary key'
      }
      suggestions.push({
        label: `${entry.alias}.${column.name}`,
        kind: monacoInstance.languages.CompletionItemKind.Field,
        insertText: `${aliasInsert}.${columnInsert}`,
        range,
        detail: column.dataType,
        documentation: { value: docValue },
        sortText: `1_${entry.alias}_${column.name}`,
      })
    }
  }
  return suggestions
}

function stripQuotesForSearch(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  const startsQuoted = trimmed.startsWith('"')
  const endsQuoted = trimmed.endsWith('"')
  const inner = trimmed.slice(startsQuoted ? 1 : 0, endsQuoted ? -1 : undefined)
  if (!inner) return ''
  return inner.replace(/""/g, '"')
}

function buildTableSuggestions(
  metadata: SchemaMetadataSnapshot,
  monacoInstance: typeof monacoEditor,
  range: monacoEditor.IRange,
  currentWord: string,
  schemaHint: string | null,
): monacoEditor.languages.CompletionItem[] {
  const baseLimit = 200
  const suggestions: monacoEditor.languages.CompletionItem[] = []
  const matched: monacoEditor.languages.CompletionItem[] = []
  const others: monacoEditor.languages.CompletionItem[] = []
  const word = stripQuotesForSearch(currentWord).toLowerCase()
  const schemaNormalized = schemaHint
    ? normalizeIdentifierForLookup(stripQuotesForSearch(schemaHint))
    : null

  for (const table of metadata.tables) {
    if (
      schemaNormalized &&
      normalizeIdentifierForLookup(table.schema) !== schemaNormalized
    ) {
      continue
    }
    const rawSchema = table.schema
    const rawName = table.name
    const schemaId = formatIdentifierIfNeeded(rawSchema)
    const tableId = formatIdentifierIfNeeded(rawName)
    const normalizedSchema = normalizeIdentifierForLookup(rawSchema)
    const normalizedName = normalizeIdentifierForLookup(rawName)
    const filterParts = new Set<string>([
      `${rawSchema}.${rawName}`,
      `${schemaId}.${tableId}`,
      `${normalizedSchema}.${normalizedName}`,
      `${normalizedSchema}${normalizedName}`,
      rawName,
      normalizedName,
      rawSchema,
      normalizedSchema,
    ])
    filterParts.add(`${rawSchema}${rawName}`)
    const filterText = Array.from(filterParts)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ')
    const insertText = schemaNormalized ? tableId : `${schemaId}.${tableId}`
    const docParts = [`Schema: \`${table.schema}\``]
    if (table.columns.length > 0) {
      const preview = table.columns
        .slice(0, 6)
        .map((col) => `${col.name}: ${col.dataType}`)
        .join(', ')
      const suffix = table.columns.length > 6 ? ' …' : ''
      docParts.push(`Columns: ${preview}${suffix}`)
    }
    const documentation: monacoEditor.IMarkdownString = { value: docParts.join('\n') }
    const entry: monacoEditor.languages.CompletionItem = {
      label: `${rawSchema}.${rawName}`,
      kind: monacoInstance.languages.CompletionItemKind.Struct,
      insertText,
      range,
      detail: `${table.columns.length} cols`,
      documentation,
      sortText: `2_${table.schema}_${table.name}`,
      filterText,
    }
    if (word) {
      const haystacks = [
        rawName,
        `${rawSchema}.${rawName}`,
        `${schemaId}.${tableId}`,
        `${normalizedSchema}.${normalizedName}`,
        `${normalizedSchema}${normalizedName}`,
        normalizedName,
      ]
        .map((value) => value.toLowerCase())
      if (haystacks.some((value) => value.includes(word))) {
        matched.push({ ...entry, sortText: `0_${table.schema}_${table.name}` })
        continue
      }
    }
    others.push(entry)
  }

  const sortedOthers = others.slice().sort((a, b) => a.label.localeCompare(b.label))

  if (word) {
    suggestions.push(...matched)
    const needed = Math.max(baseLimit, matched.length) - suggestions.length
    if (needed > 0) {
      suggestions.push(...sortedOthers.slice(0, needed))
    }
  } else {
    suggestions.push(...sortedOthers.slice(0, baseLimit))
  }
  return suggestions
}

function buildKeywordSuggestions(
  monacoInstance: typeof monacoEditor,
  range: monacoEditor.IRange,
): monacoEditor.languages.CompletionItem[] {
  return SQL_KEYWORDS.map((keyword, index) => ({
    label: keyword.toUpperCase(),
    kind: monacoInstance.languages.CompletionItemKind.Keyword,
    insertText: keyword.toUpperCase(),
    range,
    sortText: `9_${index.toString().padStart(2, '0')}`,
  }))
}

function resolveTableForColumnContext(
  context: ColumnContext,
  analysis: ContextAnalysis,
  metadata: SchemaMetadataSnapshot | null,
): SchemaMetadataTable | null {
  const aliasNormalized = normalizeIdentifierForLookup(context.aliasToken)
  const direct = analysis.aliasByKey.get(aliasNormalized)
  if (direct?.table) return direct.table
  if (metadata) {
    const schemaNormalized = context.schema ? normalizeIdentifierForLookup(context.schema) : null
    const tableMeta = lookupTable(metadata, schemaNormalized, context.aliasToken)
    if (tableMeta) return tableMeta
  }
  return null
}

function buildColumnCompletions(
  context: ColumnContext,
  analysis: ContextAnalysis,
  metadata: SchemaMetadataSnapshot | null,
  monacoInstance: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] | null {
  const table = resolveTableForColumnContext(context, analysis, metadata)
  if (!table) return null
  return buildColumnSuggestions(table, context.range, monacoInstance)
}

function buildGeneralSuggestions(
  monacoInstance: typeof monacoEditor,
  metadata: SchemaMetadataSnapshot | null,
  analysis: ContextAnalysis,
  range: monacoEditor.IRange,
  mode: 'table' | 'general',
  currentWord: string,
  schemaHint: string | null,
): monacoEditor.languages.CompletionItem[] {
  const suggestions: monacoEditor.languages.CompletionItem[] = []
  if (metadata) {
    if (mode === 'general') {
      suggestions.push(...buildScopedColumnSuggestions(analysis, monacoInstance, range))
    }
    suggestions.push(
      ...buildTableSuggestions(
        metadata,
        monacoInstance,
        range,
        currentWord,
        schemaHint,
      ),
    )
  }
  suggestions.push(...buildKeywordSuggestions(monacoInstance, range))
  return suggestions
}

type CompletionTarget = {
  word: string
  range: monacoEditor.IRange
}

function resolveCompletionTarget(
  model: monacoEditor.editor.ITextModel,
  position: monacoEditor.Position,
  monacoInstance: typeof monacoEditor,
): CompletionTarget {
  const baseWord = model.getWordUntilPosition(position)
  let currentWord = baseWord?.word ?? ''
  let startColumn = baseWord?.startColumn ?? position.column
  let endColumn = baseWord?.endColumn ?? position.column

  if (!currentWord && position.column > 1) {
    const prevChar = model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: position.column - 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    })
    if (prevChar === '"') {
      const fallbackWord = model.getWordUntilPosition({
        lineNumber: position.lineNumber,
        column: position.column - 1,
      } as monacoEditor.Position)
      if (fallbackWord?.word) {
        currentWord = fallbackWord.word
        startColumn = fallbackWord.startColumn ?? startColumn
        endColumn = fallbackWord.endColumn ?? endColumn
      }
    }
  }

  const range = new monacoInstance.Range(position.lineNumber, startColumn, position.lineNumber, endColumn)
  return { word: currentWord, range }
}

export function initializeSqlCompletion(monacoInstance: typeof monacoEditor) {
  if (initialized) return
  initialized = true
  void ensureSchemaMetadataForConnection(null).catch(() => {})
  disposable = monacoInstance.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: TRIGGER_CHARACTERS,
    provideCompletionItems: async (model, position) => {
      const metadata = getSchemaMetadataSnapshot()
      const analysis = collectContext(model, metadata)
      const columnContext = detectColumnContext(model, position, monacoInstance)
      if (columnContext) {
        const columnSuggestions = buildColumnCompletions(
          columnContext,
          analysis,
          metadata,
          monacoInstance,
        )
        if (columnSuggestions) {
          return { suggestions: columnSuggestions, incomplete: true }
        }
      }
      const valueBeforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })
      const tokens = tokenize(valueBeforeCursor)
      const qualifier = detectTableQualifier(valueBeforeCursor)
      const baseMode = determineContext(tokens)
      const { word: resolvedWord, range } = resolveCompletionTarget(model, position, monacoInstance)
      const schemaHint = qualifier?.schema ?? null
      const searchWord = qualifier ? qualifier.prefix : resolvedWord
      const mode = qualifier ? 'table' : baseMode
      const general = buildGeneralSuggestions(
        monacoInstance,
        metadata,
        analysis,
        range,
        mode,
        searchWord,
        schemaHint,
      )
      console.debug('sql-completion suggestions', {
        mode,
        schemaHint,
        searchWord,
        total: general.length,
        labels: general.map((item) => item.label),
      })
      return { suggestions: general, incomplete: true }
    },
  })
}

export function disposeSqlCompletion() {
  disposable?.dispose()
  disposable = null
  initialized = false
}

export const __test__ = {
  buildTableSuggestions,
  resolveCompletionTarget,
  detectTableQualifier,
}
