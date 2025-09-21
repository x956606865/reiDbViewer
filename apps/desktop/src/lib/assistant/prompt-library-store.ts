import Database from '@tauri-apps/plugin-sql'
import { parseJsonColumn } from '@/lib/sqlite-text'

const STORAGE_KEY = 'assistant.prompts.v1'
const builtinTimestamp = 0

export type PromptTemplate = {
  id: string
  title: string
  body: string
  category: string | null
  createdAt: number
  updatedAt: number
  isCustom: boolean
}

export type PromptInput = {
  title?: string | null
  body: string
  category?: string | null
}

type StoredPrompt = {
  id: string
  title: string
  body: string
  category: string | null
  createdAt: number
  updatedAt: number
}

type StoredPayload = {
  version: 1
  items: StoredPrompt[]
}

const builtinPrompts: PromptTemplate[] = [
  {
    id: 'builtin:explain-table',
    title: '解释表结构',
    body: '总结该表的列用途，突出主键与外键，并说明重要约束。',
    category: '表结构',
    createdAt: builtinTimestamp,
    updatedAt: builtinTimestamp,
    isCustom: false,
  },
  {
    id: 'builtin:readonly-sql',
    title: '生成只读查询',
    body: '结合提供的 schema 与需求，编写只读 SQL（仅限 SELECT 或 WITH），并解释查询逻辑。',
    category: '查询',
    createdAt: builtinTimestamp,
    updatedAt: builtinTimestamp,
    isCustom: false,
  },
  {
    id: 'builtin:data-summary',
    title: '总结数据集特征',
    body: '基于列信息与示例数据，简要概括数值范围、常见类别以及潜在异常。',
    category: '分析',
    createdAt: builtinTimestamp,
    updatedAt: builtinTimestamp,
    isCustom: false,
  },
]

function openLocal() {
  return Database.load('sqlite:rdv_local.db')
}

const now = () => Date.now()

function sanitizePromptInput(input: PromptInput): { title: string; body: string; category: string | null } {
  const body = (input.body ?? '').trim()
  if (!body) throw new Error('prompt_body_required')
  const title = (input.title ?? '').trim() || body.slice(0, 40)
  const category = input.category?.trim() || null
  return { title, body, category }
}

async function loadStored(): Promise<StoredPrompt[]> {
  try {
    const db = await openLocal()
    // @ts-ignore select exists at runtime
    const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [STORAGE_KEY])
    const raw = Array.isArray(rows) ? rows[0]?.v : undefined
    const parsed = parseJsonColumn<StoredPayload | null>(raw, null)
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) return []
    return parsed.items.map((item) => ({
      ...item,
      category: item.category ?? null,
    }))
  } catch (err) {
    console.warn('failed to load prompt library', err)
    return []
  }
}

async function saveStored(items: StoredPrompt[]): Promise<void> {
  const db = await openLocal()
  const payload: StoredPayload = { version: 1, items }
  // @ts-ignore execute exists at runtime
  await db.execute(
    `INSERT INTO app_prefs (k, v) VALUES ($1, $2)
     ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v`,
    [STORAGE_KEY, JSON.stringify(payload)],
  )
}

function toTemplate(prompt: StoredPrompt): PromptTemplate {
  return {
    ...prompt,
    category: prompt.category ?? null,
    isCustom: true,
  }
}

function mergeCustomPrompts(list: StoredPrompt[], incoming: StoredPrompt): StoredPrompt[] {
  const others = list.filter((item) => item.id !== incoming.id)
  return [incoming, ...others].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export async function listPromptLibrary(): Promise<{ builtins: PromptTemplate[]; custom: PromptTemplate[] }> {
  const custom = (await loadStored()).map(toTemplate)
  return { builtins: builtinPrompts, custom }
}

export async function listCustomPrompts(): Promise<PromptTemplate[]> {
  return (await loadStored()).map(toTemplate)
}

export async function createCustomPrompt(input: PromptInput): Promise<PromptTemplate> {
  const sanitized = sanitizePromptInput(input)
  const timestamp = now()
  const prompt: StoredPrompt = {
    id: `prompt_${Math.random().toString(36).slice(2)}${timestamp.toString(36)}`,
    title: sanitized.title,
    body: sanitized.body,
    category: sanitized.category,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const merged = mergeCustomPrompts(await loadStored(), prompt)
  await saveStored(merged)
  return toTemplate(prompt)
}

export async function updateCustomPrompt(
  id: string,
  patch: Partial<Omit<PromptInput, 'body'>> & { body?: string | null },
): Promise<PromptTemplate> {
  if (!id) throw new Error('prompt_id_required')
  const existing = await loadStored()
  const target = existing.find((item) => item.id === id)
  if (!target) throw new Error('prompt_not_found')
  const next: StoredPrompt = {
    ...target,
    title: patch.title !== undefined ? (patch.title ?? '').trim() || target.title : target.title,
    body: patch.body !== undefined ? (patch.body ?? '').trim() || target.body : target.body,
    category: patch.category !== undefined ? patch.category?.trim() || null : target.category,
    updatedAt: now(),
  }
  const merged = mergeCustomPrompts(existing, next)
  await saveStored(merged)
  return toTemplate(next)
}

export async function deleteCustomPrompt(id: string): Promise<void> {
  if (!id) return
  const existing = await loadStored()
  const filtered = existing.filter((item) => item.id !== id)
  if (filtered.length === existing.length) return
  await saveStored(filtered)
}

export function getBuiltinPrompts(): PromptTemplate[] {
  return builtinPrompts
}

export const __test__ = {
  sanitizePromptInput,
  mergeCustomPrompts,
}
