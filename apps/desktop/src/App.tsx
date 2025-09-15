import { AppShell, Group, Anchor } from '@mantine/core'
import { AppFrame } from '@/components/AppFrame'

export default function App() {
  return (
    <AppShell padding="md" header={{ height: 56 }}>
      <AppShell.Header>
        <AppFrame />
      </AppShell.Header>
      <AppShell.Main>
        <Group>
          <Anchor href="#">Schema</Anchor>
          <Anchor href="#">Browse</Anchor>
          <Anchor href="#">Queries</Anchor>
          <Anchor href="#">Connections</Anchor>
          <Anchor href="#">Ops</Anchor>
        </Group>
      </AppShell.Main>
    </AppShell>
  )
}

