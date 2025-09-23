"use client";

import React from "react";
import { Button, Group, Select, Text, Tooltip } from "@mantine/core";
import { IconPlayerPlay, IconPlus, IconPencil } from "@tabler/icons-react";
import type { QueryApiScriptSummary } from "../../../services/queryApiScripts";

export function QueryApiScriptRunnerBar({
  scripts,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onRun,
  disabled,
  running,
  hasFreshResult,
  loading,
}: {
  scripts: QueryApiScriptSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onRun: () => void;
  disabled?: boolean;
  running?: boolean;
  hasFreshResult?: boolean;
  loading?: boolean;
}) {
  const data = scripts.map((script) => ({ value: script.id, label: script.name }));
  const canEdit = selectedId != null;
  const runDisabled = disabled || !selectedId || !hasFreshResult || running;

  return (
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
        disabled={disabled}
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
            disabled={!canEdit || disabled}
          >
            编辑
          </Button>
        </div>
      </Tooltip>
      <Tooltip
        label={hasFreshResult ? "运行脚本" : "请先执行查询并确认结果"}
        disabled={hasFreshResult}
      >
        <div>
          <Button
            size="xs"
            leftSection={<IconPlayerPlay size={14} />}
            onClick={onRun}
            disabled={runDisabled}
            loading={running}
          >
            执行脚本
          </Button>
        </div>
      </Tooltip>
      {!hasFreshResult ? (
        <Text size="xs" c="dimmed">
          需先成功执行查询，才能运行脚本。
        </Text>
      ) : null}
    </Group>
  );
}
