import React from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import 'mantine-react-table/styles.css'
import './styles/overrides.css'
import App from './App'

async function installClipboardPolyfill() {
  if (typeof navigator === 'undefined') return
  const current = navigator.clipboard
  const hasWrite = typeof current?.writeText === 'function'
  const hasRead = typeof current?.readText === 'function'
  if (hasWrite && hasRead) return

  const fallbackWrite = async (text: string) => {
    if (current && typeof current.writeText === 'function') {
      return await current.writeText(text)
    }
    if (typeof document === 'undefined') {
      throw new Error('Clipboard unavailable')
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (!success) {
      throw new Error('Copy command rejected')
    }
  }

  const fallbackRead = async () => {
    if (current && typeof current.readText === 'function') {
      return await current.readText()
    }
    throw new Error('Clipboard read not supported in this environment')
  }

  const polyfill = {
    writeText: fallbackWrite,
    readText: fallbackRead,
  }

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: polyfill,
  })
}

void installClipboardPolyfill()

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <MantineProvider defaultColorScheme="light" theme={{ primaryColor: 'gray' }}>
      <Notifications />
      <App />
    </MantineProvider>
  </React.StrictMode>
)
