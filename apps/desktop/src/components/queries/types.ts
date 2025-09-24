"use client";

import type { SavedQueryVariableDef } from "@rei-db-view/types/appdb";

export type SavedItem = {
  id: string;
  name: string;
  description?: string | null;
  variables: SavedQueryVariableDef[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type TreeNode = {
  type: "folder" | "item";
  name: string;
  path: string;
  children?: TreeNode[];
  item?: SavedItem;
};

export type QueryTimingState = {
  totalMs?: number | null;
  connectMs?: number | null;
  queryMs?: number | null;
  countMs?: number | null;
};

export type CalcTimingState = {
  totalMs?: number | null;
  connectMs?: number | null;
  queryMs?: number | null;
};

export type CalcResultState = {
  loading?: boolean;
  value?: any;
  error?: string;
  groupRows?: Array<{ name: string; value: any }>;
  timing?: CalcTimingState;
};
