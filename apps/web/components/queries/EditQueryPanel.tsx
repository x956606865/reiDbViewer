"use client";

import React from "react";
import { ActionIcon, Button, Group, Paper, TextInput, Title } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import type { SavedQueryVariableDef, DynamicColumnDef, CalcItemDef } from "@rei-db-view/types/appdb";
import { SqlEditor } from "./SqlEditor";
import { VariablesEditor } from "./VariablesEditor";
import { DynamicColumnsEditor } from "./DynamicColumnsEditor";
import { CalcItemsEditor } from "./CalcItemsEditor";

export function EditQueryPanel({
  // basic info
  name,
  setName,
  description,
  setDescription,
  canSave,
  onSave,
  onSaveAs,
  onNew,
  onDelete,
  currentId,
  // sql + variables
  sql,
  setSql,
  onDetectVars,
  onAddVar,
  vars,
  setVars,
  runValues,
  setRunValues,
  onRemoveVar,
  userConnId,
  // dynamic columns + calc items
  dynCols,
  setDynCols,
  calcItems,
  setCalcItems,
}: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  canSave: boolean;
  onSave: () => void | Promise<void>;
  onSaveAs: () => void | Promise<void>;
  onNew: () => void;
  onDelete: () => void | Promise<void>;
  currentId: string | null;
  sql: string;
  setSql: (v: string) => void;
  onDetectVars: () => void;
  onAddVar: () => void;
  vars: SavedQueryVariableDef[];
  setVars: React.Dispatch<React.SetStateAction<SavedQueryVariableDef[]>>;
  runValues: Record<string, any>;
  setRunValues: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  onRemoveVar: (name: string) => void;
  userConnId?: string | null;
  dynCols: DynamicColumnDef[];
  setDynCols: React.Dispatch<React.SetStateAction<DynamicColumnDef[]>>;
  calcItems: CalcItemDef[];
  setCalcItems: React.Dispatch<React.SetStateAction<CalcItemDef[]>>;
}) {
  return (
    <>
      <Paper withBorder p="md">
        <Title order={4}>基本信息</Title>
        <Group mt="sm" align="end">
          <TextInput
            label="名称"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            w={320}
          />
          <TextInput
            label="描述"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            w={420}
          />
          <Button onClick={onSave} disabled={!canSave}>
            {currentId ? "更新" : "保存"}
          </Button>
          <Button variant="light" onClick={onSaveAs} disabled={!canSave}>
            另存为
          </Button>
          <Button variant="default" onClick={onNew}>
            新建
          </Button>
          <ActionIcon
            color="red"
            variant="light"
            onClick={onDelete}
            disabled={!currentId}
            title="删除当前"
          >
            <IconTrash size={18} />
          </ActionIcon>
        </Group>
      </Paper>

      <SqlEditor sql={sql} onChange={setSql} onDetectVars={onDetectVars} onAddVar={onAddVar} />

      <VariablesEditor
        vars={vars}
        setVars={setVars}
        runValues={runValues}
        setRunValues={setRunValues}
        onRemoveVar={onRemoveVar}
        userConnId={userConnId}
      />

      <DynamicColumnsEditor dynCols={dynCols} setDynCols={setDynCols} />

      <CalcItemsEditor
        calcItems={calcItems}
        setCalcItems={setCalcItems}
        vars={vars}
        setRunValues={setRunValues}
      />
    </>
  );
}

