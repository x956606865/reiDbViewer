/* @vitest-environment jsdom */

import type { ComponentProps } from 'react'
import { describe, it, expect } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { ResizableDataGrid } from './ResizableDataGrid'

type GridProps = ComponentProps<typeof ResizableDataGrid>

type RenderResult = {
  container: HTMLElement
  cleanup: () => void
}

function renderGrid(props: GridProps): RenderResult {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <MantineProvider>
        <ResizableDataGrid {...props} />
      </MantineProvider>
    )
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

if (typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  // @ts-expect-error - jsdom does not provide ResizeObserver
  window.ResizeObserver = ResizeObserverPolyfill
  // @ts-expect-error - align global namespace for non-browser references
  global.ResizeObserver = ResizeObserverPolyfill
}

describe('ResizableDataGrid', () => {
  it('renders provided columns and rows', () => {
    const { container, cleanup } = renderGrid({
      columns: ['id', 'email'],
      rows: [{ id: 1, email: 'foo@example.com' }],
    })
    expect(container.textContent).toContain('id')
    expect(container.textContent).toContain('email')
    expect(container.textContent).toContain('foo@example.com')
    cleanup()
  })

  it('appends action column by default', () => {
    const { container, cleanup } = renderGrid({
      columns: ['id'],
      rows: [{ id: 42 }],
    })
    const buttons = Array.from(container.querySelectorAll('button'))
    const viewButton = buttons.find((button) => button.textContent?.includes('查看'))
    expect(viewButton).toBeDefined()
    cleanup()
  })

  it('shows empty state when no rows', () => {
    const { container, cleanup } = renderGrid({ columns: ['id'], rows: [] })
    expect(container.textContent).toContain('无数据')
    cleanup()
  })
})
