import { Anchor, Group, Title } from '@mantine/core'
import ConnectionSwitcher from '@/components/ConnectionSwitcher'

export function AppFrame() {
  return (
    <Group px="md" py="sm" justify="space-between" align="center">
      <Group gap="sm" align="center">
        <Title order={4}>reiDbView Desktop</Title>
        <Anchor href="#schema">Schema</Anchor>
        <Anchor href="#browse">Browse</Anchor>
        <Anchor href="#queries">Queries</Anchor>
        <Anchor href="#connections">Connections</Anchor>
        <Anchor href="#ops">Ops</Anchor>
      </Group>
      <ConnectionSwitcher />
    </Group>
  )
}
