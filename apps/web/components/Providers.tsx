"use client"

import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider defaultColorScheme="light">
      <Notifications position="top-right" limit={3} />
      {children}
    </MantineProvider>
  )
}

