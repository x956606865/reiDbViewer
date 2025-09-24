import { notifications, type NotificationData } from '@mantine/notifications'
import { IconAlertTriangle, IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react'
import { createElement, type ReactNode } from 'react'

export type NotifyOptions = Omit<NotificationData, 'color' | 'icon' | 'message'> & {
  message: NotificationData['message']
  title?: NotificationData['title']
  icon?: NotificationData['icon']
  color?: NotificationData['color']
}

type NotifyVariant = 'success' | 'error' | 'info' | 'warning'

const VARIANT_CONFIG: Record<NotifyVariant, { color: NotificationData['color']; icon: ReactNode }> = {
  success: { color: 'teal', icon: createElement(IconCheck, { size: 16 }) },
  error: { color: 'red', icon: createElement(IconX, { size: 16 }) },
  info: { color: 'blue', icon: createElement(IconInfoCircle, { size: 16 }) },
  warning: { color: 'orange', icon: createElement(IconAlertTriangle, { size: 16 }) },
}

function showWithVariant(variant: NotifyVariant, options: NotifyOptions | ReactNode): void {
  const payload: NotifyOptions =
    typeof options === 'object' && options !== null && 'message' in options
      ? options
      : { message: options as ReactNode }
  const defaults = VARIANT_CONFIG[variant]
  notifications.show({
    ...payload,
    color: payload.color ?? defaults.color,
    icon: payload.icon ?? defaults.icon,
  })
}

export function notifySuccess(options: NotifyOptions | ReactNode): void {
  showWithVariant('success', options)
}

export function notifyError(options: NotifyOptions | ReactNode): void {
  showWithVariant('error', options)
}

export function notifyInfo(options: NotifyOptions | ReactNode): void {
  showWithVariant('info', options)
}

export function notifyWarning(options: NotifyOptions | ReactNode): void {
  showWithVariant('warning', options)
}

export type ConfirmDangerOptions = {
  title?: string
  confirmImpl?: (message: string) => boolean | Promise<boolean>
}

export async function confirmDanger(
  message: string,
  options?: ConfirmDangerOptions,
): Promise<boolean> {
  const prompt = options?.title ? `${options.title}\n\n${message}` : message
  const confirmFn = options?.confirmImpl ?? resolveConfirm()
  if (!confirmFn) return false
  try {
    const result = await confirmFn(prompt)
    return Boolean(result)
  } catch {
    return false
  }
}

function resolveConfirm(): ((message: string) => boolean) | null {
  if (typeof window === 'undefined') return null
  if (typeof window.confirm === 'function') return window.confirm.bind(window)
  return null
}
