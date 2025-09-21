"use client";

import React, { useMemo } from "react";
import {
  ActionIcon,
  Button,
  Paper,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Group,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { DynamicColumnDef } from "@rei-db-view/types/appdb";
import type { editor } from "monaco-editor";
import { CodeEditor } from "@/components/code/CodeEditor";

export function DynamicColumnsEditor({
  dynCols,
  setDynCols,
}: {
  dynCols: DynamicColumnDef[];
  setDynCols: React.Dispatch<React.SetStateAction<DynamicColumnDef[]>>;
}) {
  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      tabSize: 2,
      insertSpaces: true,
      fontSize: 13,
      wordWrap: "on",
      minimap: { enabled: false },
      lineNumbers: "off",
    }),
    [],
  );

  return (
    <Paper withBorder p="md">
      <Title order={4}>动态列</Title>
      <Text c="dimmed" size="sm">
        每个动态列包含“名称”和一个 JS 函数。函数签名： (row, vars, helpers) =&gt; any
      </Text>
      <Table mt="sm" withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={220}>名称</Table.Th>
            <Table.Th>JS 函数</Table.Th>
            <Table.Th w={120}>手动触发</Table.Th>
            <Table.Th w={60}>操作</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {dynCols.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text c="dimmed">暂无动态列</Text>
              </Table.Td>
            </Table.Tr>
          )}
          {dynCols.map((dc, i) => (
            <Table.Tr key={dc.name + i}>
              <Table.Td>
                <TextInput
                  value={dc.name}
                  onChange={(e) => {
                    const val = e.currentTarget.value;
                    setDynCols((arr) => arr.map((x, idx) => (idx === i ? { ...x, name: val } : x)));
                  }}
                />
              </Table.Td>
              <Table.Td style={{ minWidth: 420 }}>
                <CodeEditor
                  value={dc.code}
                  onChange={(val) =>
                    setDynCols((arr) =>
                      arr.map((x, idx) => (idx === i ? { ...x, code: val } : x))
                    )
                  }
                  language="javascript"
                  height={160}
                  minHeight={140}
                  options={editorOptions}
                  ariaLabel={`Dynamic column code ${dc.name ?? i}`}
                  modelPath={`file:///dynamic-columns/${i}.js`}
                  placeholder="// 函数签名: (row, vars, helpers) => any"
                />
              </Table.Td>
              <Table.Td>
                <Switch
                  checked={!!dc.manualTrigger}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    setDynCols((arr) => arr.map((x, idx) => (idx === i ? { ...x, manualTrigger: checked } : x)));
                  }}
                  label={dc.manualTrigger ? '点击按钮计算' : '自动计算'}
                />
              </Table.Td>
              <Table.Td>
                <ActionIcon color="red" variant="light" onClick={() => setDynCols((arr) => arr.filter((_, idx) => idx !== i))}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group gap="xs" mt="xs">
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          variant="light"
          onClick={() =>
            setDynCols((arr) => [
              ...arr,
              { name: `dyn_${arr.length + 1}`, code: '(row, vars) => null', manualTrigger: false },
            ])
          }
        >
          新增动态列
        </Button>
      </Group>
    </Paper>
  );
}
