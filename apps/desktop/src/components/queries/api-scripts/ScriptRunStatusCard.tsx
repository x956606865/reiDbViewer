"use client";

import React from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import type {
  QueryApiRunStatus,
  QueryApiScriptRunRecord,
} from "../../../services/queryApiScripts";
import {
  extractRunProgress,
  extractRunScriptInfo,
} from "../../../lib/api-script-run-utils";

const STATUS_META: Record<QueryApiRunStatus, { label: string; color: string }> = {
  pending: { label: "待开始", color: "gray" },
  running: { label: "执行中", color: "blue" },
  succeeded: { label: "已完成", color: "teal" },
  completed_with_errors: { label: "完成（含错误）", color: "orange" },
  failed: { label: "执行失败", color: "red" },
  cancelled: { label: "已取消", color: "gray" },
};

const formatDateTime = (value: number | string | null | undefined): string => {
  if (value == null) return "未记录";
  const date = typeof value === "string" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
};

const formatNumber = (value: number | null | undefined): string => {
  if (value == null) return "-";
  return value.toLocaleString("zh-CN");
};

export function QueryApiScriptRunStatusCard({
  run,
  loading,
  error,
  onRefresh,
  onCancel,
  cancelDisabled,
  canceling,
}: {
  run: QueryApiScriptRunRecord | null;
  loading?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  canceling?: boolean;
}) {
  const progress = run ? extractRunProgress(run) : null;
  const scriptInfo = run ? extractRunScriptInfo(run) : null;
  const statusMeta = run ? STATUS_META[run.status] : null;

  const totalBatches = progress?.totalBatches ?? null;
  const processedBatches = progress?.processedBatches ?? null;
  const totalRows = progress?.totalRows ?? null;
  const processedRows = progress?.processedRows ?? null;

  const percentFromBatches =
    totalBatches && processedBatches != null && totalBatches > 0
      ? Math.min(100, Math.max(0, (processedBatches / totalBatches) * 100))
      : null;
  const percentFromRows =
    totalRows && processedRows != null && totalRows > 0
      ? Math.min(100, Math.max(0, (processedRows / totalRows) * 100))
      : null;
  const percent = percentFromBatches ?? percentFromRows ?? null;
  const progressValue = percent != null ? percent : run ? (run.status === "running" ? 0 : 100) : 0;

  const successRows = progress?.successRows ?? null;
  const errorRows = progress?.errorRows ?? null;
  const requestCount = progress?.requestCount ?? null;
  const currentBatch = progress?.currentBatch ?? null;

  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="center" gap="xs">
          <Group gap={8} align="center">
            {statusMeta ? (
              <Badge color={statusMeta.color} variant="light">
                {statusMeta.label}
              </Badge>
            ) : (
              <Badge color="gray" variant="light">
                未开始
              </Badge>
            )}
            {loading ? <Loader size="sm" /> : null}
            {scriptInfo?.name ? (
              <Text fw={600} size="sm">
                {scriptInfo.name}
              </Text>
            ) : null}
            {scriptInfo?.method && scriptInfo?.endpoint ? (
              <Text size="xs" c="dimmed">
                {scriptInfo.method} · {scriptInfo.endpoint}
              </Text>
            ) : null}
          </Group>
          <Group gap="xs">
            {run && run.status === "running" && onCancel ? (
              <Tooltip label="取消后台任务">
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  onClick={onCancel}
                  loading={canceling}
                  disabled={cancelDisabled}
                >
                  取消任务
                </Button>
              </Tooltip>
            ) : null}
            {error ? (
              <Tooltip label={error} color="red">
                <IconAlertTriangle size={18} color="var(--mantine-color-red-filled)" />
              </Tooltip>
            ) : null}
            <Tooltip label="刷新运行状态">
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={onRefresh}
                aria-label="刷新运行状态"
                disabled={loading}
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {run ? (
          <Stack gap="xs">
            <Stack gap={6}>
              <Group justify="space-between" align="center">
                <Text size="xs" c="dimmed">
                  {totalBatches && processedBatches != null
                    ? `批次 ${processedBatches}/${totalBatches}`
                    : processedRows != null && totalRows
                      ? `已处理 ${processedRows}/${totalRows} 行`
                      : "等待统计"}
                </Text>
                {currentBatch != null ? (
                  <Text size="xs" c="dimmed">
                    当前批次 {currentBatch}
                  </Text>
                ) : null}
              </Group>
              <Progress
                value={progressValue}
                animated={run.status === "running" && percent == null}
              />
            </Stack>
            <Group gap="lg">
              <Text size="xs">成功行：{formatNumber(successRows)}</Text>
              <Text size="xs" c={errorRows && errorRows > 0 ? "red" : undefined}>
                错误行：{formatNumber(errorRows)}
              </Text>
              <Text size="xs">请求数：{formatNumber(requestCount)}</Text>
            </Group>
            <Group gap="md">
              <Text size="xs" c="dimmed">
                开始：{formatDateTime(run.startedAt)}
              </Text>
              <Text size="xs" c="dimmed">
                更新：{formatDateTime(run.updatedAt)}
              </Text>
              {(run.status === "succeeded" ||
                run.status === "completed_with_errors" ||
                run.status === "failed" ||
                run.status === "cancelled") && (
                <Text size="xs" c="dimmed">
                  完成：{formatDateTime(run.finishedAt)}
                </Text>
              )}
            </Group>
            {run.errorMessage ? (
              <Text size="xs" c="red">
                {run.errorMessage}
              </Text>
            ) : null}
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            暂无运行中的脚本任务。执行脚本后会展示实时进度。
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
