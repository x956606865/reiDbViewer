export type SafetyTriggerKind = 'write_sql' | 'secret' | 'unsafe_command'

export type SafetyTrigger = {
  kind: SafetyTriggerKind
  pattern: string
  match: string
}

export type SafetySeverity = 'none' | 'warn' | 'block'

export type SafetyEvaluation = {
  severity: SafetySeverity
  triggers: SafetyTrigger[]
}

const BLOCK_PATTERNS: Array<{ regex: RegExp; kind: SafetyTriggerKind }> = [
  { regex: /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i, kind: 'write_sql' },
  { regex: /\bDELETE\s+FROM\b/i, kind: 'write_sql' },
  { regex: /\bTRUNCATE\s+TABLE\b/i, kind: 'write_sql' },
  { regex: /\bALTER\s+TABLE\b/i, kind: 'write_sql' },
  { regex: /\bINSERT\s+INTO\b/i, kind: 'write_sql' },
  { regex: /\bUPDATE\s+[\w"\.]+\b/i, kind: 'write_sql' },
  { regex: /\bpg_terminate_backend\b/i, kind: 'unsafe_command' },
  { regex: /\bpg_cancel_backend\b/i, kind: 'unsafe_command' },
]

const WARN_PATTERNS: Array<{ regex: RegExp; kind: SafetyTriggerKind }> = [
  { regex: /APP_ENCRYPTION_KEY\s*=/i, kind: 'secret' },
  { regex: /DATABASE_URL\s*=/i, kind: 'secret' },
  { regex: /AWS_(?:ACCESS|SECRET|SESSION)_KEY/i, kind: 'secret' },
  { regex: /STRIPE_(?:SECRET|PUBLISHABLE)_KEY/i, kind: 'secret' },
]

export function evaluateAssistantResponseSafety(input: string | null | undefined): SafetyEvaluation {
  const text = (input ?? '').trim()
  if (!text) return { severity: 'none', triggers: [] }

  const triggers: SafetyTrigger[] = []

  for (const entry of BLOCK_PATTERNS) {
    const match = text.match(entry.regex)
    if (match) {
      triggers.push({ kind: entry.kind, pattern: entry.regex.source, match: match[0] ?? '' })
    }
  }

  for (const entry of WARN_PATTERNS) {
    const match = text.match(entry.regex)
    if (match) {
      triggers.push({ kind: entry.kind, pattern: entry.regex.source, match: match[0] ?? '' })
    }
  }

  if (triggers.length === 0) return { severity: 'none', triggers: [] }

  const hasBlocker = triggers.some((trigger) => trigger.kind === 'write_sql' || trigger.kind === 'unsafe_command')
  if (hasBlocker) {
    return { severity: 'block', triggers }
  }

  return { severity: 'warn', triggers }
}

export const __test__ = {
  BLOCK_PATTERNS,
  WARN_PATTERNS,
}
