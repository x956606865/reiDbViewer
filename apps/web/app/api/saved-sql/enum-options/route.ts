import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { getUserConnPool } from '@/lib/user-conn';
import { withSafeSession } from '@/lib/db';
import { compileSql, isReadOnlySelect } from '@/lib/sql-template';
import type { SavedQueryVariableDef } from '@rei-db-view/types/appdb';

const VarSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    label: z.string().max(100).optional(),
    type: z.enum([
      'text',
      'number',
      'boolean',
      'date',
      'timestamp',
      'json',
      'uuid',
      'raw',
      'enum',
    ]),
    required: z.boolean().optional(),
    default: z.any().optional(),
    options: z.array(z.string()).optional(),
    optionsSql: z.string().optional(),
  })
  .transform((val) => {
    if (val.type !== 'enum') {
      const { optionsSql, ...rest } = val;
      return { ...rest, optionsSql: undefined };
    }
    return val;
  });

const BodySchema = z.object({
  userConnId: z.string().min(1),
  sql: z.string().min(1),
  variables: z.array(VarSchema).default([]),
  values: z.record(z.any()).default({}),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'invalid_body', detail: parsed.error.format() },
      { status: 400 }
    );
  try {
    if (!process.env.APP_DB_URL)
      return NextResponse.json(
        { error: 'app_db_not_configured' },
        { status: 501 }
      );
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id)
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const { userConnId, sql, variables, values } = parsed.data;
    if (!isReadOnlySelect(sql))
      return NextResponse.json(
        { error: 'read_only_required' },
        { status: 400 }
      );
    let compiled;
    try {
      compiled = compileSql(
        sql,
        variables as SavedQueryVariableDef[],
        values
      );
    } catch (e: any) {
      return NextResponse.json(
        { error: 'compile_failed', message: String(e?.message || e) },
        { status: 400 }
      );
    }
    const pool = await getUserConnPool(session.user.id, userConnId);
    const rows = await withSafeSession(pool, env, async (client) => {
      const res = await client.query({
        text: compiled.text,
        values: compiled.values,
      });
      return res.rows as Array<Record<string, unknown>>;
    });
    // Use first column, stringify non-null values
    const options: string[] = [];
    for (const r of rows) {
      const keys = Object.keys(r);
      if (keys.length === 0) continue;
      const key = keys[0];
      if (key === undefined) continue;
      const v = r[key];
      if (v === null || v === undefined) continue;
      options.push(String(v));
    }
    // dedupe while preserving order
    const seen = new Set<string>();
    const uniq: string[] = [];
    for (const v of options) {
      if (!seen.has(v)) {
        seen.add(v);
        uniq.push(v);
      }
    }
    return NextResponse.json({ options: uniq, count: uniq.length });
  } catch (e: any) {
    return NextResponse.json(
      { error: 'fetch_failed', message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
