import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

vi.mock('@mantine/notifications', () => ({
  notifications: {
    show: vi.fn(),
  },
}))

const mockedNotifications = await import('@mantine/notifications')
const showMock = mockedNotifications.notifications.show as Mock

const { notifySuccess, notifyError, notifyWarning, confirmDanger } = await import('./notifications')

describe('notifications helpers', () => {
  beforeEach(() => {
    showMock.mockClear()
  })

  afterEach(() => {
    // reset injected window between tests
    delete (globalThis as any).window
  })

  it('emits success notification with defaults', () => {
    notifySuccess('Operation completed')
    expect(showMock).toHaveBeenCalledTimes(1)
    expect(showMock.mock.calls[0][0]).toMatchObject({
      message: 'Operation completed',
      color: 'teal',
    })
  })

  it('allows overriding title and color on error notification', () => {
    notifyError({ message: 'Failed', title: 'Oops', color: 'dark' })
    expect(showMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed',
        title: 'Oops',
        color: 'dark',
      }),
    )
  })

  it('falls back to provided confirm implementation', async () => {
    const confirmImpl = vi.fn().mockResolvedValue(true)
    const ok = await confirmDanger('Danger zone', { confirmImpl })
    expect(ok).toBe(true)
    expect(confirmImpl).toHaveBeenCalledWith('Danger zone')
  })

  it('uses window.confirm when available', async () => {
    const confirmSpy = vi.fn().mockReturnValue(false)
    ;(globalThis as any).window = { confirm: confirmSpy }
    const ok = await confirmDanger('Shall we?')
    expect(confirmSpy).toHaveBeenCalledWith('Shall we?')
    expect(ok).toBe(false)
  })

  it('returns false when no confirm function exists', async () => {
    const ok = await confirmDanger('Missing confirm')
    expect(ok).toBe(false)
  })

  it('supports warning variant', () => {
    notifyWarning({ message: 'Heads up' })
    const lastCall = showMock.mock.calls.at(-1)
    expect(lastCall?.[0]).toMatchObject({
      message: 'Heads up',
      color: 'orange',
    })
  })
})
