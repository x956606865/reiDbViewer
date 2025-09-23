"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Popover,
  Progress,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowRight,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useApiScriptRuns } from "../../../lib/use-api-script-runs";
import {
  extractRunProgress,
  extractRunScriptInfo,
} from "../../../lib/api-script-run-utils";
import { cancelApiScriptRun } from "../../../services/apiScriptRunner";

const STATUS_LABEL: Record<string, string> = {
  pending: "待开始",
  running: "执行中",
  succeeded: "已完成",
  completed_with_errors: "完成（含错误）",
  failed: "执行失败",
  cancelled: "已取消",
};

const formatNumber = (value: number | null | undefined): string => {
  if (value == null) return "-";
  return value.toLocaleString("zh-CN");
};

const formatPercent = (value: number | null | undefined): string | null => {
  if (value == null || Number.isNaN(value)) return null;
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
};

export function ActiveApiScriptRunIndicator({
  onNavigateToQueries,
}: {
  onNavigateToQueries?: () => void;
}) {
  const {
    activeRun,
    pendingEventCount,
    loading,
    refresh,
  } = useApiScriptRuns(null, { includeAllQueries: true, limit: 20 });

  const [opened, setOpened] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const progress = useMemo(() => {
    if (!activeRun) return null;
    return extractRunProgress(activeRun);
  }, [activeRun]);

  const scriptInfo = useMemo(() => {
    if (!activeRun) return null;
    return extractRunScriptInfo(activeRun);
  }, [activeRun]);

  const percent = useMemo(() => {
    if (!progress) return null;
    if (
      progress.totalBatches &&
      progress.processedBatches != null &&
      progress.totalBatches > 0
    ) {
      return (progress.processedBatches / progress.totalBatches) * 100;
    }
    if (progress.totalRows && progress.processedRows != null && progress.totalRows > 0) {
      return (progress.processedRows / progress.totalRows) * 100;
    }
    return null;
  }, [progress]);

  const showIndicator = Boolean(activeRun) || pendingEventCount > 0;

  const handleOpen = useCallback(() => {
    if (!showIndicator) return;
    setOpened((prev) => !prev);
  }, [showIndicator]);

  useEffect(() => {
    if (!showIndicator && opened) {
      setOpened(false);
    }
  }, [opened, showIndicator]);

  const handleNavigate = useCallback(() => {
    setOpened(false);
    onNavigateToQueries?.();
  }, [onNavigateToQueries]);

  const handleCancel = useCallback(async () => {
    if (!activeRun) return;
    if (canceling) return;
    setCanceling(true);
    try {
      await cancelApiScriptRun(activeRun.id);
      notifications.show({
        color: "orange",
        title: "已发送取消指令",
        message: "脚本任务将尽快停止。",
        icon: <IconAlertTriangle size={16} />,
      });
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notifications.show({
        color: "red",
        title: "取消失败",
        message,
        icon: <IconX size={16} />,
      });
    } finally {
      setCanceling(false);
    }
  }, [activeRun, canceling, refresh]);

  if (!showIndicator) return null;

  const status = activeRun?.status ?? "running";
  const statusLabel = STATUS_LABEL[status] ?? status;
  const displayName = scriptInfo?.name ?? (activeRun ? `任务 ${activeRun.id.slice(0, 8)}` : "后台任务");
  const percentText = formatPercent(percent);

  return (
    <Popover opened={opened} onChange={setOpened} width={320} position="bottom-end">
      <Popover.Target>
        <Tooltip label="后台脚本任务正在执行" opened={opened ? false : undefined}>
          <Button
            variant="light"
            size="xs"
            leftSection={loading ? <Loader size="xs" /> : <IconActivity size={16} />}
            onClick={handleOpen}
            color="blue"
          >
            脚本执行中
          </Button>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          {activeRun ? (
            <Stack gap={6}>
              <Group gap="xs" justify="space-between" align="center">
                <Stack gap={2}>
                  <Text fw={600} size="sm">
                    {displayName}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {statusLabel}
                  </Text>
                </Stack>
                <Badge color="blue" variant="light">
                  {percentText ?? "进行中"}
                </Badge>
              </Group>
              <Progress value={percent ?? undefined} animated={percent == null} />
              <Group gap="lg">
                <Text size="xs">成功行：{formatNumber(progress?.successRows)}</Text>
                <Text size="xs" c={progress?.errorRows ? "red" : undefined}>
                  错误行：{formatNumber(progress?.errorRows)}
                </Text>
              </Group>
              <Group gap="sm" justify="space-between">
                <Button variant="subtle" size="xs" onClick={handleNavigate} rightSection={<IconArrowRight size={14} />}>
                  查看详情
                </Button>
                {(status === "running" || status === "pending") && (
                  <Button
                    variant="light"
                    size="xs"
                    color="red"
                    onClick={handleCancel}
                    loading={canceling}
                  >
                    取消任务
                  </Button>
                )}
              </Group>
              {scriptInfo?.method && scriptInfo?.endpoint ? (
                <Text size="xs" c="dimmed">
                  {scriptInfo.method} · {scriptInfo.endpoint}
                </Text>
              ) : null}
            </Stack>
          ) : (
            <Group gap="xs" wrap="wrap" align="center">
              <Loader size="sm" />
              <Text size="sm">正在同步脚本任务状态...</Text>
              <Anchor size="xs" onClick={handleNavigate}>
                前往查询页
              </Anchor>
              <Button
                variant="subtle"
                size="xs"
                leftSection={<IconRefresh size={14} />}
                onClick={() => {
                  void refresh();
                }}
              >
                重新尝试
              </Button>
            </Group>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
