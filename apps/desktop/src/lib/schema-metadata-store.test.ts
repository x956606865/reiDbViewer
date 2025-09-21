import { beforeEach, describe, expect, it, vi } from 'vitest';

const readSchemaCache = vi.fn();
const getCurrentConnId = vi.fn<[], string | null>(() => null);
const subscribeCurrentConnId = vi.fn<(cb: (id: string | null) => void) => () => void>(() => () => {});

vi.mock('@/lib/schema-cache', () => ({
  readSchemaCache,
}));

vi.mock('@/lib/current-conn', () => ({
  getCurrentConnId,
  subscribeCurrentConnId,
}));

type SchemaCachePayload = {
  databases: string[];
  schemas: string[];
  tables: Array<{
    schema: string;
    name: string;
    columns: Array<{ name: string; dataType: string; nullable?: boolean; isPrimaryKey?: boolean }>;
  }>;
};

const samplePayload: SchemaCachePayload = {
  databases: ['postgres'],
  schemas: ['public'],
  tables: [
    {
      schema: 'public',
      name: 'users',
      columns: [
        { name: 'id', dataType: 'integer', nullable: false, isPrimaryKey: true },
        { name: 'email', dataType: 'text' },
      ],
    },
  ],
};

describe('schema-metadata-store', () => {
  beforeEach(() => {
    vi.resetModules();
    readSchemaCache.mockReset();
    getCurrentConnId.mockReset();
    getCurrentConnId.mockReturnValue(null);
    subscribeCurrentConnId.mockReset();
    subscribeCurrentConnId.mockImplementation(() => () => {});
  });

  it('hydrates snapshot when ensuring metadata for explicit connection id', async () => {
    readSchemaCache.mockResolvedValue({ payload: samplePayload, updatedAt: 1700000000 });
    const { ensureSchemaMetadataForConnection, getSchemaMetadataSnapshot } = await import('./schema-metadata-store');

    expect(getSchemaMetadataSnapshot()).toBeNull();

    await ensureSchemaMetadataForConnection('test-conn');

    const snapshot = getSchemaMetadataSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.connectionId).toBe('test-conn');
    expect(snapshot?.tables.map((t) => t.name)).toEqual(['users']);
  });
});
