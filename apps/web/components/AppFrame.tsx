"use client"

import Link from 'next/link'
import {
  ActionIcon,
  Anchor,
  AppShell,
  Button,
  Group,
  Text,
  useMantineColorScheme,
} from '@mantine/core'
import { IconMoon, IconSun, IconDatabase } from '@tabler/icons-react'

function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const next = colorScheme === 'dark' ? 'light' : 'dark'
  return (
    <ActionIcon
      variant="light"
      onClick={() => setColorScheme(next)}
      aria-label="Toggle color scheme"
    >
      {colorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  )
}

export default function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" align="center">
          <IconDatabase size={18} />
          <Anchor component={Link} href="/" fw={700} underline="never">
            reiDbView
          </Anchor>
          <Group gap="xs">
            <Anchor component={Link} href="/schema" underline="hover">
              Schema
            </Anchor>
            <Anchor component={Link} href="/preview" underline="hover">
              Preview
            </Anchor>
            <Anchor component={Link} href="/connections" underline="hover">
              Connections
            </Anchor>
            <Anchor component={Link} href="/ops" underline="hover">
              Ops
            </Anchor>
          </Group>
          <Group ml="auto" gap="xs">
            <Button component={Link} href="/install" variant="default" size="xs">
              Install
            </Button>
            <ThemeToggle />
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  )
}
