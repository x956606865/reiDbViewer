"use client"

import { MantineProvider, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'

const theme = createTheme({
  defaultRadius: 'sm',
  primaryColor: 'gray', // 全局主色调统一为灰色系
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  components: {
    ActionIcon: {
      defaultProps: {
        variant: 'subtle',
        color: 'gray',
        size: 'sm',
        radius: 'sm',
      },
      styles: () => ({
        root: {
          background: 'transparent',
        },
      }),
    },
    ThemeIcon: {
      defaultProps: {
        variant: 'subtle',
        color: 'gray',
        size: 'sm',
        radius: 'sm',
      },
    },
  },
})

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" limit={3} />
      {children}
    </MantineProvider>
  )
}
