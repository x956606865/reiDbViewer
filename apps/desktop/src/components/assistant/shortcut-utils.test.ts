import { describe, expect, it } from 'vitest'
import { shouldSubmitOnShiftEnter } from './shortcut-utils'

type ShortcutOptions = Parameters<typeof shouldSubmitOnShiftEnter>[1]

const baseState: ShortcutOptions = {
  hasInput: true,
  isStreaming: false,
  isError: false,
}

describe('shouldSubmitOnShiftEnter', () => {
  it('returns true when shift+enter pressed with input available', () => {
    expect(shouldSubmitOnShiftEnter({ key: 'Enter', shiftKey: true }, baseState)).toBe(true)
  })

  it('returns false when key is not Enter', () => {
    expect(shouldSubmitOnShiftEnter({ key: 'Tab', shiftKey: true }, baseState)).toBe(false)
  })

  it('returns false when shift key is not pressed', () => {
    expect(shouldSubmitOnShiftEnter({ key: 'Enter', shiftKey: false }, baseState)).toBe(false)
  })

  it('returns false when input is empty', () => {
    expect(shouldSubmitOnShiftEnter({ key: 'Enter', shiftKey: true }, { ...baseState, hasInput: false })).toBe(false)
  })

  it('returns false while streaming response', () => {
    expect(shouldSubmitOnShiftEnter({ key: 'Enter', shiftKey: true }, { ...baseState, isStreaming: true })).toBe(false)
  })

  it('returns false if composer is disabled due to error state', () => {
    expect(shouldSubmitOnShiftEnter({ key: 'Enter', shiftKey: true }, { ...baseState, isError: true })).toBe(false)
  })
})
