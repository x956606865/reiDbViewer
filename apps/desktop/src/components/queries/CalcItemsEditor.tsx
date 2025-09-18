"use client";

import React, { useMemo } from "react";
import {
  ActionIcon,
  Button,
  Code,
  Group,
  Paper,
  Select,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { CalcItemDef, SavedQueryVariableDef } from "@rei-db-view/types/appdb";
import type { editor } from "monaco-editor";
import { CodeEditor } from "@/components/code/CodeEditor";

export function CalcItemsEditor({
  calcItems,
  setCalcItems,
  vars,
  setRunValues,
}: {
  calcItems: CalcItemDef[];
  setCalcItems: React.Dispatch<React.SetStateAction<CalcItemDef[]>>;
  vars: SavedQueryVariableDef[];
  setRunValues: React.Dispatch<React.SetStateAction<Record<string, any>>>;
}) {
  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "on",
      minimap: { enabled: false },
    }),
    [],
  );

  return (
    <Paper withBorder p="md">
      <Title order={4}>计算数据</Title>
      <Text c="dimmed" size="sm">
        配置在“运行”时可点击手动计算的指标。支持三种形式：
      </Text>
      <Text c="dimmed" size="sm">
        1) SQL：可使用所有变量，另提供 <Code>{"{{"}_sql{"}}"}</Code> 为当前查询未包裹分页的原始 SQL（将被作为 CTE 注入）。
      </Text>
      <Text c="dimmed" size="sm">
        2) JS：函数签名 <Code>(vars, rows, helpers) =&gt; any</Code>，其中 rows 为当前页数据。
      </Text>
      <Text c="dimmed" size="sm">
        3) 计算数据组：SQL 返回两列（name、value），每行都会渲染为独立的计算单元。
      </Text>
      <Table mt="sm" withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={220}>名称</Table.Th>
            <Table.Th w={120}>类型</Table.Th>
            <Table.Th w={120}>形式</Table.Th>
            <Table.Th w={140}>执行模式</Table.Th>
            <Table.Th>代码</Table.Th>
            <Table.Th w={60}>操作</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {calcItems.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <Text c="dimmed">暂无计算数据</Text>
              </Table.Td>
            </Table.Tr>
          )}
          {calcItems.map((ci, i) => {
            const placeholder =
              ci.type === 'js'
                ? '// 编写 JS 计算逻辑，例如 return rows.length'
                : '-- 编写只读 SQL，可引用 {{_sql}}';
            return (
              <Table.Tr key={i}>
              <Table.Td>
                <TextInput
                  value={ci.name}
                  onChange={(e) => {
                    const val = e.currentTarget.value;
                    setCalcItems((arr) => arr.map((x, idx) => (idx === i ? { ...x, name: val } : x)));
                  }}
                />
              </Table.Td>
              <Table.Td>
                <Select
                  data={[
                    { value: "sql", label: "SQL" },
                    { value: "js", label: "JS" },
                  ]}
                  value={ci.type}
                  onChange={(v) =>
                    setCalcItems((arr) =>
                      arr.map((x, idx) => {
                        if (idx !== i) return x;
                        const nextType = (v as 'sql' | 'js' | null) ?? 'sql';
                        const nextKind = nextType === 'js' ? 'single' : (x.kind ?? 'single');
                        return { ...x, type: nextType, kind: nextKind };
                      })
                    )
                  }
                  disabled={(ci.kind ?? 'single') === 'group'}
                />
              </Table.Td>
              <Table.Td>
                <Select
                  data={[
                    { value: "single", label: "普通" },
                    { value: "group", label: "数据组" },
                  ]}
                  value={ci.kind ?? 'single'}
                  onChange={(v) =>
                    setCalcItems((arr) =>
                      arr.map((x, idx) => {
                        if (idx !== i) return x;
                        const nextKind = (v as 'single' | 'group' | null) ?? 'single';
                        return {
                          ...x,
                          kind: nextKind,
                          type: nextKind === 'group' ? 'sql' : x.type,
                        };
                      })
                    )
                  }
                />
              </Table.Td>
              <Table.Td>
                <Select
                  data={[
                    { value: "always", label: "完全" },
                    { value: "initial", label: "首次拉取" },
                    { value: "manual", label: "手动" },
                  ]}
                  value={ci.runMode ?? 'manual'}
                  onChange={(v) =>
                    setCalcItems((arr) =>
                      arr.map((x, idx) =>
                        idx === i ? { ...x, runMode: ((v as any) ?? 'manual') as 'always' | 'initial' | 'manual' } : x
                      )
                    )
                  }
                />
              </Table.Td>
              <Table.Td style={{ minWidth: 420 }}>
                <CodeEditor
                  value={ci.code}
                  onChange={(val) =>
                    setCalcItems((arr) =>
                      arr.map((x, idx) => (idx === i ? { ...x, code: val } : x))
                    )
                  }
                  language={ci.type === 'js' ? 'javascript' : 'sql'}
                  height={ci.kind === 'group' ? 200 : 160}
                  minHeight={140}
                  options={editorOptions}
                  ariaLabel={`Calc item code ${ci.name ?? i}`}
                  modelPath={`file:///calc-items/${i}.${ci.type === 'js' ? 'js' : 'sql'}`}
                  placeholder={placeholder}
                />
              </Table.Td>
              <Table.Td>
                <ActionIcon color="red" variant="light" onClick={() => setCalcItems((arr) => arr.filter((_, idx) => idx !== i))}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          );
          })}
        </Table.Tbody>
      </Table>
      <Group mt="xs" gap="xs">
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          variant="light"
          onClick={() =>
            setCalcItems((arr) => [
              ...arr,
              {
                name: `calc_${arr.length + 1}`,
                type: "sql",
                code: "select count(*) as total from ({{_sql}}) t",
                runMode: 'manual',
                kind: 'single',
              },
            ])
          }
        >
          新增计算
        </Button>
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          variant="light"
          onClick={() =>
            setCalcItems((arr) => [
              ...arr,
              {
                name: `calc_group_${arr.length + 1}`,
                type: "sql",
                code: "select name, value from ({{_sql}}) t limit 5",
                runMode: 'manual',
                kind: 'group',
              },
            ])
          }
        >
          新增计算数据组
        </Button>
        <Button
          size="xs"
          variant="light"
          onClick={() =>
            setRunValues(Object.fromEntries(vars.map((v) => [v.name, v.default ?? ""])))}
        >
          重置为默认值
        </Button>
      </Group>
    </Paper>
  );
}
