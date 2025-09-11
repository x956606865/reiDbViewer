'use client'

import { useEffect, useState } from 'react'
import { Loader, Paper, Stack, Table, Text, Title } from '@mantine/core'

type TableMeta = { schema: string; name: string; columns: { name: string; dataType: string }[] }

export default function SchemaPage() {
  const [tables, setTables] = useState<TableMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/schema/tables')
      .then((r) => r.json())
      .then((json) => setTables(json.tables || []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading)
    return (
      <Stack gap="md">
        <Loader />
        <Text c="dimmed">加载中…</Text>
      </Stack>
    )
  if (error)
    return (
      <Text c="red">加载失败：{error}</Text>
    )

  return (
    <Stack gap="md">
      <div>
        <Title order={3}>Schema Explorer（Mock）</Title>
        <Text c="dimmed">来自 /api/schema/tables 的 mock 数据。</Text>
      </div>
      {tables.map((t) => (
        <Paper withBorder p="sm" key={`${t.schema}.${t.name}`}>
          <Title order={5}>
            {t.schema}.{t.name}
          </Title>
          <Table mt="xs" striped withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>列名</Table.Th>
                <Table.Th>数据类型</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {t.columns.map((c) => (
                <Table.Tr key={c.name}>
                  <Table.Td>{c.name}</Table.Td>
                  <Table.Td>
                    <Text c="dimmed">{c.dataType}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      ))}
    </Stack>
  )
}
