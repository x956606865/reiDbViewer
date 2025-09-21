import { Button, Group, Paper } from '@mantine/core'

export type ConversationToolbarProps = {
  onOpenSettings: () => void
  apiKeyReady: boolean | null
}

export function ConversationToolbar({ onOpenSettings, apiKeyReady }: ConversationToolbarProps) {
  const ready = Boolean(apiKeyReady)
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="flex-end">
        <Button
          variant={ready ? 'light' : 'filled'}
          color={ready ? 'teal' : 'yellow'}
          onClick={onOpenSettings}
        >
          {ready ? '更新 API key' : '配置 API key'}
        </Button>
      </Group>
    </Paper>
  )
}
