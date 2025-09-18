import { Avatar, Box, Group, Tabs, Text, Title, type MantineTheme } from '@mantine/core';
import {
  IconDatabase,
  IconTable,
  IconCodeDots,
  IconPlugConnected,
  IconHeartbeat,
} from '@tabler/icons-react';
import ConnectionSwitcher from '@/components/ConnectionSwitcher';
import appIcon from '../../src-tauri/icons/icon.png';

type AppFrameProps = {
  active: string | null;
  onNavigate: (value: string) => void;
};

const NAV_ITEMS = [
  { value: 'schema', label: 'Schema', icon: IconDatabase },
  // { value: 'browse', label: 'Browse', icon: IconTable },
  { value: 'queries', label: 'Queries', icon: IconCodeDots },
  { value: 'connections', label: 'Connections', icon: IconPlugConnected },
  { value: 'ops', label: 'Ops', icon: IconHeartbeat },
];

export function AppFrame({ active, onNavigate }: AppFrameProps) {
  const current = active || 'connections';

  return (
    <Box
      px="md"
      py="sm"
      style={{
        backgroundColor: 'var(--mantine-color-body)',
      }}
    >
      <Group justify="space-between" align="center">
        <Group gap="md" align="center">
          <Avatar
            src={appIcon}
            size={44}
            radius="md"
            alt="Rei DbView Desktop icon"
          />
          <div>
            <Title order={5}>Rei DbView Desktop</Title>
            <Text size="xs" c="dimmed">
              Read-only Postgres browser
            </Text>
          </div>
          <Tabs
            value={current}
            onChange={(value) => {
              if (value) onNavigate(value);
            }}
            variant="pills"
            radius="md"
            vars={(theme: MantineTheme) => ({
              root: {
                '--tabs-color': theme.colors.blue[0],
                '--tabs-text-color': theme.colors.blue[9],
              },
            })}
            styles={(theme) => ({
              root: {
                '--tabs-text-color': theme.colors.blue[9],
              },
              list: {
                gap: '6px',
                paddingBottom: 0,
                border: 'none',
                boxShadow: 'none',
              },
              tab: {
                fontWeight: 600,
                fontSize: '17px',
                border: 0,
                color: 'var(--mantine-color-gray-7)',
                paddingBlock: '10px',
                transition: 'background-color 80ms ease',
                '--tab-hover-color': 'var(--mantine-color-blue-0)',
                '&[data-active]': {
                  backgroundColor: 'var(--mantine-color-blue-0)',
                  color: 'var(--mantine-color-blue-9)',
                  boxShadow: 'inset 0 0 0 1px var(--mantine-color-blue-3)',
                },
              },
              tabSection: {
                marginRight: '6px',
              },
            })}
          >
            <Tabs.List>
              {NAV_ITEMS.map(({ value, label, icon: Icon }) => (
                <Tabs.Tab
                  key={value}
                  value={value}
                  leftSection={<Icon size={15} />}
                >
                  {label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        </Group>
        <Group gap="sm" align="center">
          <ConnectionSwitcher />
        </Group>
      </Group>
    </Box>
  );
}
