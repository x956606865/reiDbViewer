import { describe, it, expect, vi } from 'vitest'
import {
  createSavedQueriesApi,
  isSavedQueriesApiError,
} from './saved-queries-api'

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })

describe('saved-queries-api', () => {
  it('list returns normalized items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          items: [
            {
              id: 'id-1',
              name: 'recent',
              description: 'desc',
              variables: [{ name: 'v1', type: 'text' }],
              dynamic_columns: [{ name: 'dc', code: '() => 1' }],
              calc_items: [{ name: 'count', type: 'sql', code: 'select 1' }],
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-02T00:00:00Z',
            },
          ],
        },
        { status: 200 },
      ),
    )
    const api = createSavedQueriesApi(fetchMock)
    const list = await api.list()
    expect(fetchMock).toHaveBeenCalledWith('/api/user/saved-sql', {
      cache: 'no-store',
    })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'id-1',
      name: 'recent',
      description: 'desc',
      dynamicColumns: [{ name: 'dc', code: '() => 1' }],
      calcItems: [{ name: 'count', type: 'sql', code: 'select 1' }],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    })
  })

  it('list throws not_initialized error with suggested SQL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: 'feature_not_initialized',
          suggestedSQL: 'CREATE TABLE ...',
        },
        { status: 501 },
      ),
    )
    const api = createSavedQueriesApi(fetchMock)
    await expect(api.list()).rejects.toSatisfy((err: unknown) => {
      if (!isSavedQueriesApiError(err)) return false
      expect(err.type).toBe('not_initialized')
      expect(err.suggestedSQL).toBe('CREATE TABLE ...')
      return true
    })
  })

  it('create surfaces conflict error with existing id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: 'name_exists',
          existingId: 'existing-1',
        },
        { status: 409 },
      ),
    )
    const api = createSavedQueriesApi(fetchMock)
    await expect(
      api.create({
        name: 'dup',
        sql: 'select 1',
        variables: [],
      }),
    ).rejects.toSatisfy((err: unknown) => {
      if (!isSavedQueriesApiError(err)) return false
      expect(err.type).toBe('conflict')
      expect(err.existingId).toBe('existing-1')
      return true
    })
  })

  it('update converts network failures into api errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('failed'))
    const api = createSavedQueriesApi(fetchMock)
    await expect(api.update('abc', { name: 'x' })).rejects.toSatisfy(
      (err: unknown) => {
        if (!isSavedQueriesApiError(err)) return false
        expect(err.type).toBe('network')
        return true
      },
    )
  })

  it('get maps 404 into not_found error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'not_found' }, { status: 404 }),
    )
    const api = createSavedQueriesApi(fetchMock)
    await expect(api.get('missing')).rejects.toSatisfy((err: unknown) => {
      if (!isSavedQueriesApiError(err)) return false
      expect(err.type).toBe('not_found')
      return true
    })
  })
})
