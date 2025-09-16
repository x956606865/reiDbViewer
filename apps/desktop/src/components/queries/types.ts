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

