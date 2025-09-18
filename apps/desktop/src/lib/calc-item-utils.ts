import type { CalcItemDef, CalcItemRunMode } from '@rei-db-view/types/appdb';

type CalcItemInput = {
  name: string;
  type: 'sql' | 'js';
  code: string;
  runMode?: CalcItemRunMode;
  kind?: 'single' | 'group';
};

export function normalizeCalcItem(input: CalcItemInput): CalcItemDef {
  const runMode = input.runMode ?? 'manual';
  if (input.type === 'js') {
    return {
      name: input.name,
      type: 'js',
      code: input.code,
      runMode,
      kind: 'single',
    };
  }

  if (input.kind === 'group') {
    return {
      name: input.name,
      type: 'sql',
      code: input.code,
      runMode,
      kind: 'group',
    };
  }

  return {
    name: input.name,
    type: 'sql',
    code: input.code,
    runMode,
    kind: 'single',
  };
}

export function normalizeCalcItems(items: readonly CalcItemInput[] | null | undefined): CalcItemDef[] {
  if (!items) return [];
  return items.map((item) => normalizeCalcItem(item));
}

export function mergeCalcItem(base: CalcItemDef, patch: Partial<CalcItemInput>): CalcItemDef {
  return normalizeCalcItem({
    ...base,
    ...patch,
  });
}
