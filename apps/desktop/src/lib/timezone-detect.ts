export const OFFSET_PATTERN = /(Z|[+-]\d{2}(?::?\d{2}){0,2})$/i

const TIMESTAMP_WITH_OFFSET = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}(?::\d{2}(?::\d{2}(?:\.\d{1,9})?)?)?))?\s*(Z|[+-]\d{2}(?::?\d{2}){0,2})$/i

function normalizeTimePart(part?: string): string | null {
  if (!part) return '00:00:00'
  const m = part.match(/^(\d{1,2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2] ?? '0')
  const second = Number(m[3] ?? '0')
  if ([hour, minute, second].some((n) => !Number.isFinite(n))) return null
  const fraction = m[4] ? `.${m[4]}` : ''
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(hour)}:${pad(minute)}:${pad(second)}${fraction}`
}

function normalizeOffset(offset: string): string | null {
  if (/^Z$/i.test(offset)) return 'Z'
  const m = offset.match(/^([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?$/)
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  const hours = Number(m[2])
  const minutes = Number(m[3] ?? '0')
  const seconds = Number(m[4] ?? '0')
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
  const totalMinutes = sign * (hours * 60 + minutes + seconds / 60)
  const absTotalMinutes = Math.round(Math.abs(totalMinutes))
  const outSign = totalMinutes < 0 ? '-' : '+'
  const outHours = String(Math.floor(absTotalMinutes / 60)).padStart(2, '0')
  const outMinutes = String(absTotalMinutes % 60).padStart(2, '0')
  return `${outSign}${outHours}:${outMinutes}`
}

export function normalizeTimestampWithOffset(value: string): string | null {
  const trimmed = value.trim()
  const match = trimmed.match(TIMESTAMP_WITH_OFFSET)
  if (!match) return null
  const [, datePart, timePartRaw, offsetRaw] = match
  if (!datePart || !offsetRaw) return null
  const timePart = normalizeTimePart(timePartRaw)
  const offsetPart = normalizeOffset(offsetRaw)
  if (!timePart || !offsetPart) return null
  const isoCandidate = `${datePart}T${timePart}${offsetPart}`
  const asDate = new Date(isoCandidate)
  if (Number.isNaN(asDate.getTime())) return null
  return isoCandidate
}

export function isTimestampWithOffset(value: unknown): value is string {
  return typeof value === 'string' && normalizeTimestampWithOffset(value) !== null
}

export function parseTimestampWithOffset(value: string): Date | null {
  const iso = normalizeTimestampWithOffset(value)
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
