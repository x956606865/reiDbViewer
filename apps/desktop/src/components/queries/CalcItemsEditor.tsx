"use client";

import React from "react";
import {
  ActionIcon,
  Button,
  Code,
  Group,
  Paper,
  Select,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { CalcItemDef, SavedQueryVariableDef } from "@rei-db-view/types/appdb";

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
  return (
    <Paper withBorder p="md">
      <Title order={4}>计算数据</Title>
      <Text c="dimmed" size="sm">
        配置在“运行”时可点击手动计算的指标。支持两种方式：
      </Text>
      <Text c="dimmed" size="sm">
        1) SQL：可使用所有变量，另提供 <Code>{"{{"}_sql{"}}"}</Code> 为当前查询未包裹分页的原始 SQL（将被作为 CTE 注入）。
      </Text>
      <Text c="dimmed" size="sm">
        2) JS：函数签名 <Code>(vars, rows, helpers) =&gt; any</Code>，其中 rows 为当前页数据。
      </Text>
      <Table mt="sm" withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={220}>名称</Table.Th>
            <Table.Th w={120}>类型</Table.Th>
            <Table.Th>代码</Table.Th>
            <Table.Th w={60}>操作</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {calcItems.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text c="dimmed">暂无计算数据</Text>
              </Table.Td>
            </Table.Tr>
          )}
          {calcItems.map((ci, i) => (
            <Table.Tr key={ci.name + i}>
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
                      arr.map((x, idx) => (idx === i ? { ...x, type: (v as any) || "sql" } : x))
                    )
                  }
                />
              </Table.Td>
              <Table.Td>
                <Textarea
                  value={ci.code}
                  onChange={(e) => {
                    const val = e.currentTarget.value;
                    setCalcItems((arr) => arr.map((x, idx) => (idx === i ? { ...x, code: val } : x)));
                  }}
                  autosize
                  minRows={3}
                  styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                />
              </Table.Td>
              <Table.Td>
                <ActionIcon color="red" variant="light" onClick={() => setCalcItems((arr) => arr.filter((_, idx) => idx !== i))}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
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
              },
            ])
          }
        >
          新增计算
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
