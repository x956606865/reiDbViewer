import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSchemaMetadataSnapshot } from '@/lib/schema-metadata-store';
import { __test__, disposeSqlCompletion, initializeSqlCompletion } from './sql-completion';

vi.mock('@/lib/schema-metadata-store', () => {
  const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_$]*$/;
  const formatIdentifierIfNeeded = (name: string) =>
    IDENTIFIER_PATTERN.test(name) && name === name.toLowerCase() ? name : `"${name.replace(/"/g, '""')}"`;
  const normalizeIdentifierForLookup = (name: string) => {
    const trimmed = name.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
      return trimmed.slice(1, -1).replace(/""/g, '"').toLowerCase();
    }
    return trimmed.toLowerCase();
  };
  return {
    ensureSchemaMetadataForConnection: vi.fn().mockResolvedValue(undefined),
    getSchemaMetadataSnapshot: vi.fn(),
    subscribeSchemaMetadata: vi.fn(),
    applySchemaMetadataPayload: vi.fn(),
    formatIdentifierIfNeeded,
    normalizeIdentifierForLookup,
  };
});

type SchemaMetadataTable = {
  schema: string;
  name: string;
  columns: Array<{ name: string; dataType?: string }>;
  columnMap: Map<string, unknown>;
};

type SchemaMetadataSnapshot = {
  connectionId: string;
  updatedAt: number;
  tables: SchemaMetadataTable[];
  tablesByKey: Map<string, SchemaMetadataTable>;
  tablesByName: Map<string, SchemaMetadataTable[]>;
};

class RangeStub {
  constructor(
    public startLineNumber: number,
    public startColumn: number,
    public endLineNumber: number,
    public endColumn: number,
  ) {}
}

class PositionStub {
  constructor(
    public lineNumber: number,
    public column: number,
  ) {}
}

let registeredProvider: any = null;

const monacoStub = {
  languages: {
    CompletionItemKind: {
      Struct: 23,
      Field: 4,
      Keyword: 14,
    },
    registerCompletionItemProvider: vi.fn((_, provider) => {
      registeredProvider = provider;
      return { dispose: vi.fn() };
    }),
  },
  Range: RangeStub,
  Position: PositionStub,
} as any;

beforeEach(() => {
  registeredProvider = null;
  disposeSqlCompletion();
  vi.clearAllMocks();
});

class ModelStub {
  constructor(private readonly value: string) {}

  getValue() {
    return this.value;
  }

  getValueInRange(range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }) {
    const { startLineNumber, startColumn, endLineNumber, endColumn } = range;
    const lines = this.value.split('\n');
    const startLineIndex = Math.max(0, startLineNumber - 1);
    const endLineIndex = Math.max(0, endLineNumber - 1);
    if (startLineIndex === endLineIndex) {
      const line = lines[startLineIndex] ?? '';
      return line.slice(startColumn - 1, endColumn - 1);
    }
    const segments: string[] = [];
    const firstLine = lines[startLineIndex] ?? '';
    segments.push(firstLine.slice(startColumn - 1));
    for (let idx = startLineIndex + 1; idx < endLineIndex; idx += 1) {
      segments.push(lines[idx] ?? '');
    }
    const lastLine = lines[endLineIndex] ?? '';
    segments.push(lastLine.slice(0, Math.max(0, endColumn - 1)));
    return segments.join('\n');
  }

  getWordUntilPosition(position: { lineNumber: number; column: number }) {
    const { lineNumber, column } = position;
    const lines = this.value.split('\n');
    const line = lines[Math.max(0, lineNumber - 1)] ?? '';
    const endIndex = Math.max(0, column - 1);
    const wordChars = /[A-Za-z0-9_"$]/;
    let startIndex = endIndex;
    while (startIndex > 0 && wordChars.test(line[startIndex - 1])) {
      startIndex -= 1;
    }
    const word = line.slice(startIndex, endIndex);
    return {
      word,
      startColumn: startIndex + 1,
      endColumn: endIndex + 1,
    };
  }
}

function buildMetadata(total: number): SchemaMetadataSnapshot {
  const tables: SchemaMetadataTable[] = [];
  const tablesByKey = new Map<string, SchemaMetadataTable>();
  const tablesByName = new Map<string, SchemaMetadataTable[]>();

  for (let i = 0; i < total; i += 1) {
    const schema = 'cnb';
    const name = i === total - 1 ? 'Companies' : `table_${i.toString().padStart(3, '0')}`;
    const table: SchemaMetadataTable = {
      schema,
      name,
      columns: [],
      columnMap: new Map(),
    };
    tables.push(table);
    const key = `${schema}.${name}`.toLowerCase();
    tablesByKey.set(key, table);
    const arr = tablesByName.get(name.toLowerCase()) || [];
    arr.push(table);
    tablesByName.set(name.toLowerCase(), arr);
  }

  return {
    connectionId: 'conn',
    updatedAt: Date.now(),
    tables,
    tablesByKey,
    tablesByName,
  };
}

describe('buildTableSuggestions', () => {
  it('includes matching table even when beyond base limit', async () => {
    const metadata = buildMetadata(260);
    const range = new RangeStub(1, 1, 1, 1);
    const suggestions = __test__.buildTableSuggestions(metadata, monacoStub, range, 'Comp', null);
    const labels = suggestions.map((s) => s.label);
    expect(labels).toContain('cnb.Companies');
  });

  it('handles partially quoted word fragments', () => {
    const metadata = buildMetadata(10);
    const range = new RangeStub(1, 1, 1, 1);
    const suggestions = __test__.buildTableSuggestions(metadata, monacoStub, range, '"Comp', null);
    const labels = suggestions.map((s) => s.label);
    expect(labels).toContain('cnb.Companies');
  });

  it('limits results without word to base limit', () => {
    const metadata = buildMetadata(260);
    const range = new RangeStub(1, 1, 1, 1);
    const suggestions = __test__.buildTableSuggestions(metadata, monacoStub, range, '', null);
    expect(suggestions.length).toBe(200);
  });

  it('filters tables by schema hint when provided', () => {
    const tableA: SchemaMetadataTable = {
      schema: 'cnb',
      name: 'Companies',
      columns: [],
      columnMap: new Map(),
    };
    const tableB: SchemaMetadataTable = {
      schema: 'public',
      name: 'Other',
      columns: [],
      columnMap: new Map(),
    };
    const metadata: SchemaMetadataSnapshot = {
      connectionId: 'conn',
      updatedAt: Date.now(),
      tables: [tableA, tableB],
      tablesByKey: new Map([
        ['cnb.companies', tableA],
        ['public.other', tableB],
      ]),
      tablesByName: new Map([
        ['companies', [tableA]],
        ['other', [tableB]],
      ]),
    };
    const range = new RangeStub(1, 1, 1, 1);
    const suggestions = __test__.buildTableSuggestions(metadata, monacoStub, range, '', 'cnb');
    const labels = suggestions.map((s) => s.label);
    expect(labels).toEqual(['cnb.Companies']);
  });

  it('inserts bare table identifier when schema hint is present', () => {
    const table: SchemaMetadataTable = {
      schema: 'cnb',
      name: 'Companies',
      columns: [],
      columnMap: new Map(),
    };
    const metadata: SchemaMetadataSnapshot = {
      connectionId: 'conn',
      updatedAt: Date.now(),
      tables: [table],
      tablesByKey: new Map([
        ['cnb.companies', table],
      ]),
      tablesByName: new Map([
        ['companies', [table]],
      ]),
    };
    const range = new RangeStub(1, 1, 1, 1);
    const [suggestion] = __test__.buildTableSuggestions(metadata, monacoStub, range, 'Com', 'cnb');
    expect(suggestion.insertText).toBe('"Companies"');
  });

  it('populates filter text with raw and normalized combinations', () => {
    const table: SchemaMetadataTable = {
      schema: 'CNB',
      name: 'Companies',
      columns: [],
      columnMap: new Map(),
    };
    const metadata: SchemaMetadataSnapshot = {
      connectionId: 'conn',
      updatedAt: Date.now(),
      tables: [table],
      tablesByKey: new Map([
        ['cnb.companies', table],
      ]),
      tablesByName: new Map([
        ['companies', [table]],
      ]),
    };
    const range = new RangeStub(1, 1, 1, 1);
    const [suggestion] = __test__.buildTableSuggestions(metadata, monacoStub, range, '', null);
    const filterTokens = new Set((suggestion.filterText ?? '').split(' '));
    expect(filterTokens.has('CNB.Companies')).toBe(true);
    expect(filterTokens.has('"CNB"."Companies"')).toBe(true);
    expect(filterTokens.has('cnb.companies')).toBe(true);
    expect(filterTokens.has('cnbcompanies')).toBe(true);
    expect(filterTokens.has('companies')).toBe(true);
  });
});

describe('detectTableQualifier', () => {
  it('extracts schema and partially quoted prefix', () => {
    const fragment = 'select * from cnb."Comp';
    const qualifier = __test__.detectTableQualifier(fragment);
    expect(qualifier?.schema).toBe('cnb');
    expect(qualifier?.prefix).toBe('"Comp');
  });

  it('handles trailing whitespace after dot', () => {
    const fragment = 'select * from cnb.\n';
    const qualifier = __test__.detectTableQualifier(fragment);
    expect(qualifier?.schema).toBe('cnb');
    expect(qualifier?.prefix).toBe('');
  });
});

describe('resolveCompletionTarget', () => {
  it('falls back to identifier before closing quote when cursor is after it', () => {
    const model = {
      getWordUntilPosition: vi
        .fn()
        .mockReturnValueOnce({ word: '', startColumn: 20, endColumn: 20 })
        .mockReturnValueOnce({ word: 'Comp', startColumn: 16, endColumn: 20 }),
      getValueInRange: vi.fn().mockReturnValue('"'),
    } as any;
    const position = new PositionStub(1, 20);
    const { word, range } = __test__.resolveCompletionTarget(model, position, monacoStub);
    expect(word).toBe('Comp');
    expect(range.startColumn).toBe(16);
    expect(range.endColumn).toBe(20);
  });
});

describe('sql completion provider', () => {
  it('returns table suggestions when the prefix is schema qualified without alias match', async () => {
    const metadata = buildMetadata(5) as any;
    vi.mocked(getSchemaMetadataSnapshot).mockReturnValue(metadata);

    initializeSqlCompletion(monacoStub);
    expect(registeredProvider).toBeTruthy();

    const text = 'select * from cnb.';
    const model = new ModelStub(text) as any;
    const position = new PositionStub(1, text.length + 1) as any;
    const result = await registeredProvider!.provideCompletionItems(model, position);
    expect(result.incomplete).toBe(true);
    const labels = result.suggestions.map((item: any) => item.label);
    expect(labels).toContain('cnb.Companies');
  });

  it.each([
    'select * from cnb.Com',
    'select * from cnb."Com',
    'select * from cnb."Com"',
  ])('suggests schema-qualified tables when typing %s', async (text) => {
    const metadata = buildMetadata(5) as any;
    vi.mocked(getSchemaMetadataSnapshot).mockReturnValue(metadata);

    initializeSqlCompletion(monacoStub);
    expect(registeredProvider).toBeTruthy();

    const model = new ModelStub(text) as any;
    const position = new PositionStub(1, text.length + 1) as any;
    const result = await registeredProvider!.provideCompletionItems(model, position);
    expect(result.incomplete).toBe(true);
    const labels = result.suggestions.map((item: any) => item.label);
    expect(labels).toContain('cnb.Companies');
  });
});
