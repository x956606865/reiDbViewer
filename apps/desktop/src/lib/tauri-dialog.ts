import { invoke } from '@tauri-apps/api/core';

export type SaveDialogFilter = {
  name: string;
  extensions: string[];
};

export type SaveDialogOptions = {
  title?: string;
  defaultPath?: string;
  filters?: SaveDialogFilter[];
  canCreateDirectories?: boolean;
};

export async function saveDialog(options: SaveDialogOptions): Promise<string | null> {
  const result = await invoke<string | null>('plugin:dialog|save', { options });
  return result ?? null;
}
