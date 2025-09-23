"use client";

import React from "react";
import { Button, Group, Select, Stack, Text, Tooltip } from "@mantine/core";
import { IconPlayerPlay, IconPlus, IconPencil, IconCopy, IconTrash } from "@tabler/icons-react";
import type { QueryApiScriptSummary } from "../../../services/queryApiScripts";

export function QueryApiScriptRunnerBar({
  scripts,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onDuplicate,
  onDelete,
  onRun,
  disabled,
  running,
  hasFreshResult,
  loading,
  busy,
  error,
}: {
  scripts: QueryApiScriptSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (script: QueryApiScriptSummary) => void;
  onRun: () => void;
  disabled?: boolean;
  running?: boolean;
  hasFreshResult?: boolean;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
}) {
  const data = scripts.map((script) => ({ value: script.id, label: script.name }));
  const canEdit = selectedId != null;
  const runDisabled = disabled || !selectedId || !hasFreshResult || running;
  const selectedScript = selectedId
    ? scripts.find((script) => script.id === selectedId) ?? null
    : null;
  const canDuplicate = Boolean(selectedScript && onDuplicate);
  const canDelete = Boolean(selectedScript && onDelete);

  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="wrap">
        <Select
          label="API 脚本"
          placeholder={loading ? "加载脚本中..." : "选择脚本"}
          data={data}
          value={selectedId}
          onChange={(value) => onSelect(value ?? null)}
          searchable
          clearable
          nothingFoundMessage="暂无脚本"
          style={{ minWidth: 240 }}
          disabled={loading}
        />
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => onCreate()}
          disabled={disabled || busy}
        >
          新建脚本
        </Button>
        <Tooltip label={canEdit ? "编辑脚本" : "请选择脚本"}>
          <div>
            <Button
              variant="default"
              size="xs"
              leftSection={<IconPencil size={14} />}
              onClick={() => {
                if (selectedId) onEdit(selectedId);
              }}
              disabled={!canEdit || disabled || busy}
            >
              编辑
            </Button>
          </div>
        </Tooltip>
        {onDuplicate ? (
          <Tooltip label={canDuplicate ? "复制脚本" : "请选择脚本"}>
            <div>
              <Button
                variant="default"
                size="xs"
                leftSection={<IconCopy size={14} />}
                onClick={() => {
                  if (selectedId && onDuplicate) onDuplicate(selectedId);
                }}
                disabled={!canDuplicate || disabled || busy}
              >
                复制
              </Button>
            </div>
          </Tooltip>
        ) : null}
        {onDelete ? (
          <Tooltip label={canDelete ? "删除脚本" : "请选择脚本"}>
            <div>
              <Button
                variant="outline"
                color="red"
                size="xs"
                leftSection={<IconTrash size={14} />}
                onClick={() => {
                  if (selectedScript && onDelete) onDelete(selectedScript);
                }}
                disabled={!canDelete || disabled || busy}
              >
                删除
              </Button>
            </div>
          </Tooltip>
        ) : null}
        <Tooltip
          label={hasFreshResult ? "运行脚本" : "请先执行查询并确认结果"}
          disabled={hasFreshResult}
        >
          <div>
            <Button
              size="xs"
              leftSection={<IconPlayerPlay size={14} />}
              onClick={onRun}
              disabled={runDisabled || busy}
              loading={running}
            >
              执行脚本
            </Button>
          </div>
        </Tooltip>
      </Group>
      {!hasFreshResult ? (
        <Text size="xs" c="dimmed">
          需先成功执行查询，才能运行脚本。
        </Text>
      ) : null}
      {error ? (
        <Text size="xs" c="red">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
}
