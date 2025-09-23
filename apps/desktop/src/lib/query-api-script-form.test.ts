import { describe, expect, it } from 'vitest'
import {
  createEmptyScriptForm,
  createHeaderDraft,
  scriptRecordToForm,
  scriptFormToInput,
  type QueryApiScriptFormState,
} from './query-api-script-form'
import type { QueryApiScriptRecord } from '../services/queryApiScripts'

const sampleRecord: QueryApiScriptRecord = {
  id: 'qas_1',
  queryId: 'query_1',
  name: 'Sync Orders',
  description: 'Push orders to API',
  method: 'POST',
  endpoint: 'https://api.example.com/orders',
  headers: [
    { id: 'hdr_a', key: 'Authorization', value: 'Bearer 123', sensitive: true },
    { id: 'hdr_b', key: 'X-Trace', value: 'abc', sensitive: false },
  ],
  fetchSize: 500,
  sendBatchSize: 100,
  sleepMs: 250,
  requestTimeoutMs: 60000,
  errorPolicy: 'continue',
  bodyTemplate: '{"items": {{batch}} }',
  createdAt: '2025-09-21T12:00:00.000Z',
  updatedAt: '2025-09-21T12:00:00.000Z',
}

describe('query api script form helpers', () => {
  it('createEmptyScriptForm provides sane defaults', () => {
    const form = createEmptyScriptForm({ queryId: 'query_9' })
    expect(form.queryId).toBe('query_9')
    expect(form.method).toBe('POST')
    expect(form.fetchSize).toBe(500)
    expect(form.sendBatchSize).toBe(100)
    expect(form.sleepMs).toBe(0)
    expect(form.requestTimeoutMs).toBe(60000)
    expect(form.errorPolicy).toBe('continue')
    expect(form.headers).toEqual([])
  })

  it('scriptRecordToForm preserves fields and attaches header ids', () => {
    const form = scriptRecordToForm(sampleRecord)
    expect(form.id).toBe(sampleRecord.id)
    expect(form.headers).toHaveLength(sampleRecord.headers.length)
    for (const header of form.headers) {
      expect(typeof header.id).toBe('string')
      expect(header.id.length).toBeGreaterThan(0)
    }
    expect(form.name).toBe(sampleRecord.name)
    expect(form.description).toBe(sampleRecord.description)
  })

  it('scriptFormToInput round-trips with record conversion', () => {
    const form = scriptRecordToForm(sampleRecord)
    const input = scriptFormToInput(form)
    expect(input.id).toBe(sampleRecord.id)
    expect(input.queryId).toBe(sampleRecord.queryId)
    expect(input.name).toBe(sampleRecord.name)
    expect(input.endpoint).toBe(sampleRecord.endpoint)
    expect(input.headers).toHaveLength(sampleRecord.headers.length)
    expect(input.fetchSize).toBe(sampleRecord.fetchSize)
    expect(input.sendBatchSize).toBe(sampleRecord.sendBatchSize)
    expect(input.requestTimeoutMs).toBe(sampleRecord.requestTimeoutMs)
    expect(input.errorPolicy).toBe(sampleRecord.errorPolicy)
    expect(input.bodyTemplate).toBe(sampleRecord.bodyTemplate)
  })

  it('scriptFormToInput trims data and drops empty description', () => {
    const form: QueryApiScriptFormState = {
      id: 'qas_trim',
      queryId: 'query_trim',
      name: '  nightly sync  ',
      description: '  ',
      method: ' post ',
      endpoint: '  https://api.example.com/items  ',
      headers: [
        { id: 'hdr_1', key: ' X-Test ', value: ' 1 ', sensitive: false },
      ],
      fetchSize: 200,
      sendBatchSize: 50,
      sleepMs: 0,
      requestTimeoutMs: 45000,
      errorPolicy: ' CONTINUE ',
      bodyTemplate: '  {"batch": {{batch}} }  ',
    }
    const input = scriptFormToInput(form)
    expect(input.name).toBe('nightly sync')
    expect(input.description).toBeNull()
    expect(input.method).toBe('POST')
    expect(input.endpoint).toBe('https://api.example.com/items')
    expect(input.headers?.[0]?.key).toBe('X-Test')
    expect(input.headers?.[0]?.value).toBe('1')
    expect(input.errorPolicy).toBe('continue')
    expect(input.bodyTemplate).toBe('{"batch": {{batch}} }')
  })

  it('scriptFormToInput enforces sendBatchSize <= fetchSize', () => {
    const form = createEmptyScriptForm({ queryId: 'q_err' })
    const bad: QueryApiScriptFormState = {
      ...form,
      fetchSize: 100,
      sendBatchSize: 150,
    }
    expect(() => scriptFormToInput(bad)).toThrowError()
  })

  it('createHeaderDraft produces a blank header with unique id', () => {
    const first = createHeaderDraft()
    const second = createHeaderDraft()
    expect(first.id).not.toBe(second.id)
    expect(first.key).toBe('')
    expect(first.value).toBe('')
    expect(first.sensitive).toBe(false)
  })
})
