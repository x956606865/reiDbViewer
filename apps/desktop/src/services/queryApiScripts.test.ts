import { describe, expect, it } from 'vitest';
import {
  queryApiScriptInputSchema,
  QUERY_API_METHODS,
  QUERY_API_ERROR_POLICIES,
} from './queryApiScripts';

describe('queryApiScriptInputSchema', () => {
  it('accepts a well-formed payload and normalizes fields', () => {
    const result = queryApiScriptInputSchema.parse({
      queryId: 'q_123',
      name: ' Hook Sync  ',
      description: ' send data ',
      method: 'post',
      endpoint: ' https://api.example.com/hooks ',
      headers: [
        { key: 'Authorization', value: 'Bearer test' },
        { key: 'X-Custom', value: '42' },
      ],
      fetchSize: 250,
      sendBatchSize: 50,
      sleepMs: 250,
      requestTimeoutMs: 45_000,
      errorPolicy: 'continue',
      bodyTemplate: '{"items": {{batch}} }',
    });

    expect(result.queryId).toBe('q_123');
    expect(result.name).toBe('Hook Sync');
    expect(result.description).toBe('send data');
    expect(result.method).toBe('POST');
    expect(result.endpoint).toBe('https://api.example.com/hooks');
    expect(result.headers).toHaveLength(2);
    expect(result.headers[0]?.key).toBe('Authorization');
    expect(result.headers[1]?.key).toBe('X-Custom');
    expect(result.fetchSize).toBe(250);
    expect(result.sendBatchSize).toBe(50);
    expect(result.sleepMs).toBe(250);
    expect(result.requestTimeoutMs).toBe(45_000);
    expect(result.errorPolicy).toBe('continue');
    expect(result.bodyTemplate).toBe('{"items": {{batch}} }');
  });

  it('rejects unsupported HTTP methods', () => {
    expect(() =>
      queryApiScriptInputSchema.parse({
        queryId: 'q_123',
        name: 'bad',
        method: 'TRACE',
        endpoint: 'https://example.com',
        headers: [],
        fetchSize: 100,
        sendBatchSize: 50,
        sleepMs: 0,
        requestTimeoutMs: 10_000,
        errorPolicy: 'continue',
      }),
    ).toThrowError();
  });

  it('rejects duplicate header keys ignoring case', () => {
    expect(() =>
      queryApiScriptInputSchema.parse({
        queryId: 'q_123',
        name: 'dup headers',
        method: 'POST',
        endpoint: 'https://example.com',
        headers: [
          { key: 'Authorization', value: 'Bearer a' },
          { key: 'authorization', value: 'Bearer b' },
        ],
        fetchSize: 100,
        sendBatchSize: 50,
        sleepMs: 0,
        requestTimeoutMs: 10_000,
        errorPolicy: 'continue',
      }),
    ).toThrowError();
  });

  it('rejects fetch/send size beyond allowed range', () => {
    expect(() =>
      queryApiScriptInputSchema.parse({
        queryId: 'q_123',
        name: 'too big fetch',
        method: 'POST',
        endpoint: 'https://example.com',
        headers: [],
        fetchSize: 5000,
        sendBatchSize: 10,
        sleepMs: 0,
        requestTimeoutMs: 10_000,
        errorPolicy: 'continue',
      }),
    ).toThrowError();

    expect(() =>
      queryApiScriptInputSchema.parse({
        queryId: 'q_123',
        name: 'too big send',
        method: 'POST',
        endpoint: 'https://example.com',
        headers: [],
        fetchSize: 100,
        sendBatchSize: 2000,
        sleepMs: 0,
        requestTimeoutMs: 10_000,
        errorPolicy: 'continue',
      }),
    ).toThrowError();
  });

  it('rejects negative sleep or too small timeout', () => {
    expect(() =>
      queryApiScriptInputSchema.parse({
        queryId: 'q_123',
        name: 'bad sleep',
        method: 'POST',
        endpoint: 'https://example.com',
        headers: [],
        fetchSize: 100,
        sendBatchSize: 50,
        sleepMs: -1,
        requestTimeoutMs: 10_000,
        errorPolicy: 'continue',
      }),
    ).toThrowError();

    expect(() =>
      queryApiScriptInputSchema.parse({
        queryId: 'q_123',
        name: 'bad timeout',
        method: 'POST',
        endpoint: 'https://example.com',
        headers: [],
        fetchSize: 100,
        sendBatchSize: 50,
        sleepMs: 0,
        requestTimeoutMs: 500,
        errorPolicy: 'continue',
      }),
    ).toThrowError();
  });

  it('rejects unsupported error policy', () => {
    expect(QUERY_API_ERROR_POLICIES).toContain('continue');
    expect(() =>
      queryApiScriptInputSchema.parse({
        queryId: 'q_123',
        name: 'bad policy',
        method: 'POST',
        endpoint: 'https://example.com',
        headers: [],
        fetchSize: 100,
        sendBatchSize: 50,
        sleepMs: 0,
        requestTimeoutMs: 10_000,
        errorPolicy: 'retry',
      }),
    ).toThrowError();
  });
});

it('exposes supported HTTP methods list', () => {
  expect(QUERY_API_METHODS).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
});
