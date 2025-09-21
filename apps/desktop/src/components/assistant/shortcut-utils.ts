export type ShortcutState = {
  hasInput: boolean
  isStreaming: boolean
  isError: boolean
}

export type ShortcutEventLike = {
  key: string
  shiftKey?: boolean
}

export function shouldSubmitOnShiftEnter(event: ShortcutEventLike, state: ShortcutState): boolean {
  if (state.isStreaming || state.isError) return false
  if (!state.hasInput) return false
  if (event.key !== 'Enter') return false
  return event.shiftKey === true
}
