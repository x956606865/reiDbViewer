import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Modal,
  Progress,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconBellRinging,
  IconCheck,
  IconCloudDownload,
  IconRefresh,
} from '@tabler/icons-react'
import {
  DEFAULT_SNOOZE_MS,
  useAppUpdateAutoCheck,
  useAppUpdateStore,
  type UpdatePhase,
} from '@/hooks/useAppUpdate'

const phaseLabels: Record<UpdatePhase, string> = {
  idle: 'Check for updates',
  checking: 'Checking for updates…',
  available: 'Update available',
  downloading: 'Downloading update…',
  installing: 'Installing update…',
  relaunching: 'Restarting…',
  failed: 'Update failed',
  unavailable: 'Updater unavailable',
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function toRelative(timestamp: number): string {
  const diff = timestamp - Date.now()
  const thresholds = [
    { unit: 'minute', ms: 60 * 1000 },
    { unit: 'hour', ms: 60 * 60 * 1000 },
    { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  ] as const

  for (const entry of thresholds) {
    if (Math.abs(diff) < entry.ms * (entry.unit === 'minute' ? 60 : entry.unit === 'hour' ? 24 : 30)) {
      const value = Math.round(diff / entry.ms)
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(value, entry.unit)
    }
  }
  const days = Math.round(diff / (24 * 60 * 60 * 1000))
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(days, 'day')
}

function formatDate(input: string | null): string | null {
  if (!input) return null
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) return null
  const absolute = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
  const relative = toRelative(parsed.getTime())
  return `${absolute} (${relative})`
}

const DEFAULT_REMIND_MS = DEFAULT_SNOOZE_MS

export function AppUpdateIndicator() {
  const [modalOpened, setModalOpened] = useState(false)
  const {
    phase,
    update,
    progress,
    lastCheckedAt,
    lastError,
    currentVersion,
    isBusy,
  } = useAppUpdateStore((state) => ({
    phase: state.phase,
    update: state.update,
    progress: state.progress,
    lastCheckedAt: state.lastCheckedAt,
    lastError: state.lastError,
    currentVersion: state.currentVersion,
    isBusy: state.isBusy,
  }))
  const { checkForUpdates, downloadAndInstall, dismissUpdate, resetError } = useAppUpdateStore((state) => ({
    checkForUpdates: state.checkForUpdates,
    downloadAndInstall: state.downloadAndInstall,
    dismissUpdate: state.dismissUpdate,
    resetError: state.resetError,
  }))

  useAppUpdateAutoCheck(true)

  useEffect(() => {
    if (phase === 'available') {
      setModalOpened(true)
    }
  }, [phase])

  const progressSummary = useMemo(() => {
    if (!progress) return null
    const { downloaded, total } = progress
    if (!total || total <= 0) {
      return `${formatBytes(downloaded)} downloaded`
    }
    const percent = Math.min(100, Math.max(0, Math.round((downloaded / total) * 100)))
    return `${percent}% · ${formatBytes(downloaded)} / ${formatBytes(total)}`
  }, [progress])

  const releaseDate = useMemo(() => formatDate(update?.releaseDate ?? null), [update?.releaseDate])
  const lastCheckedLabel = useMemo(() => {
    if (!lastCheckedAt) return null
    return toRelative(lastCheckedAt)
  }, [lastCheckedAt])

  const handlePrimaryAction = async () => {
    if (phase === 'available' || phase === 'downloading' || phase === 'installing' || phase === 'relaunching') {
      setModalOpened(true)
      return
    }

    if (phase === 'failed') {
      setModalOpened(true)
      resetError()
      await checkForUpdates({ userInitiated: true })
      return
    }

    if (phase === 'unavailable') {
      setModalOpened(true)
      return
    }

    if (phase === 'checking') {
      setModalOpened(true)
      return
    }

    setModalOpened(true)
    await checkForUpdates({ userInitiated: true })
  }

  const handleInstall = async () => {
    await downloadAndInstall()
  }

  const handleRemindLater = async () => {
    await dismissUpdate({ remindInMs: DEFAULT_REMIND_MS })
    setModalOpened(false)
  }

  const handleCloseModal = () => {
    if (phase === 'failed') {
      resetError()
    }
    setModalOpened(false)
  }

  const buttonColor = phase === 'available' ? 'teal' : phase === 'failed' ? 'red' : 'gray'
  const showBadge = phase === 'available'

  return (
    <>
      <Tooltip label={phaseLabels[phase]} position="bottom" withArrow>
        <Button
          size="xs"
          variant={phase === 'available' ? 'light' : 'subtle'}
          color={buttonColor}
          leftSection={
            phase === 'available' ? (
              <IconCloudDownload size={16} />
            ) : phase === 'checking' ? (
              <Loader size="xs" />
            ) : phase === 'failed' ? (
              <IconAlertCircle size={16} />
            ) : phase === 'downloading' || phase === 'installing' || phase === 'relaunching' ? (
              <Loader size="xs" />
            ) : (
              <IconRefresh size={16} />
            )
          }
          onClick={handlePrimaryAction}
          disabled={phase === 'relaunching'}
          loading={phase === 'checking' || phase === 'downloading' || phase === 'installing'}
          rightSection={
            showBadge ? (
              <Badge color="teal" size="sm" radius="sm" variant="filled">
                new
              </Badge>
            ) : null
          }
        >
          {phaseLabels[phase]}
        </Button>
      </Tooltip>

      <Modal opened={modalOpened} onClose={handleCloseModal} title="Application Update" centered size="lg">
        <Stack gap="md">
          {phase === 'available' && update ? (
            <Stack gap="xs">
              <Title order={4}>Version {update.version}</Title>
              <Text size="sm" c="dimmed">
                Current version: {currentVersion ?? 'unknown'}
              </Text>
              {releaseDate ? (
                <Text size="xs" c="dimmed">
                  Released {releaseDate}
                </Text>
              ) : null}
              <ScrollArea h={180} type="auto" offsetScrollbars>
                <Box pr="sm">
                  <Text size="sm" c="dimmed">
                    {update.notes ?? 'No release notes provided.'}
                  </Text>
                </Box>
              </ScrollArea>
            </Stack>
          ) : null}

          {phase === 'idle' && !update ? (
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <IconCheck size={16} color="var(--mantine-color-teal-6)" />
                <Title order={5}>You are up to date</Title>
              </Group>
              {lastCheckedLabel ? (
                <Text size="sm" c="dimmed">
                  Last checked {lastCheckedLabel}
                </Text>
              ) : null}
            </Stack>
          ) : null}

          {(phase === 'downloading' || phase === 'installing' || phase === 'relaunching') && (
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <IconCloudDownload size={16} />
                <Title order={5}>Preparing update</Title>
              </Group>
              {progress ? (
                <Stack gap={4}>
                  <Progress value={progress.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : 100} />
                  {progressSummary ? (
                    <Text size="xs" c="dimmed">
                      {progressSummary}
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
              {phase === 'installing' ? (
                <Text size="sm" c="dimmed">
                  Installing the downloaded update. This should take only a few seconds.
                </Text>
              ) : null}
              {phase === 'relaunching' ? (
                <Text size="sm" c="dimmed">
                  Relaunching the application. You may close this window if it does not disappear automatically.
                </Text>
              ) : null}
            </Stack>
          )}

          {phase === 'failed' && lastError ? (
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <IconAlertCircle size={16} color="var(--mantine-color-red-6)" />
                <Title order={5}>Update failed</Title>
              </Group>
              <Text size="sm" c="red">
                {lastError}
              </Text>
              <Text size="sm" c="dimmed">
                Retry the check or come back later. You can also download installers from the releases page.
              </Text>
            </Stack>
          ) : null}

          {phase === 'unavailable' ? (
            <Stack gap="xs">
              <Group gap="xs" align="center">
                <IconBellRinging size={16} />
                <Title order={5}>Automatic updates are disabled</Title>
              </Group>
              <Text size="sm" c="dimmed">
                This environment does not expose the Tauri updater plugin. Try the packaged desktop build to enable automatic updates.
              </Text>
            </Stack>
          ) : null}

          <Group justify="space-between" mt="md">
            <Group gap="xs">
              <Button
                variant="default"
                size="xs"
                leftSection={<IconRefresh size={14} />}
                onClick={() => checkForUpdates({ userInitiated: true })}
                loading={phase === 'checking'}
              >
                Re-check
              </Button>
              <Button
                variant="light"
                size="xs"
                color="gray"
                leftSection={<IconBellRinging size={14} />}
                onClick={handleRemindLater}
                disabled={phase !== 'available'}
              >
                Remind me later
              </Button>
            </Group>
            <Button
              size="xs"
              color="teal"
              leftSection={<IconCloudDownload size={14} />}
              onClick={handleInstall}
              disabled={phase !== 'available'}
              loading={phase === 'downloading' || phase === 'installing' || phase === 'relaunching'}
            >
              Install update
            </Button>
          </Group>

          {phase === 'available' ? (
            <Text size="xs" c="dimmed">
              You can keep working while the update downloads. The app will prompt to restart once ready.
            </Text>
          ) : null}
        </Stack>
      </Modal>
    </>
  )
}
