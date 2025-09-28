export type ColumnKind = "numeric" | "date" | "json" | "other";

export type BuildLineChartParams = {
  rows: Array<Record<string, unknown>>;
  xKey: string | null;
  yKey: string | null;
  limit: number;
  xJsonPath?: string;
  yJsonPath?: string;
  columnKinds?: Record<string, ColumnKind>;
};

export type BuildLineChartResult = {
  data: Array<Record<string, unknown>>;
  series: Array<{ name: string }>;
  error: string | null;
  valueFormatter?: (value: number) => string;
  xKind: ColumnKind | null;
  yKind: ColumnKind | null;
};

const MIN_POINTS = 3;

export function buildLineChartData({
  rows,
  xKey,
  yKey,
  limit,
  xJsonPath,
  yJsonPath,
  columnKinds,
}: BuildLineChartParams): BuildLineChartResult {
  if (!xKey || !yKey) {
    return {
      data: [],
      series: [],
      error: "请选择横轴与纵轴列",
      xKind: null,
      yKind: null,
    };
  }

  const fallbackColumns = [xKey, yKey].filter((key): key is string => typeof key === "string");
  const kinds = columnKinds ?? getColumnKinds(rows, fallbackColumns);
  const xKindHint = kinds[xKey] ?? "other";
  const yKindHint = kinds[yKey] ?? "other";

  const normalizedLimit = clampLimit(limit, rows.length);
  const trimmedXPath = normalizeJsonPath(xJsonPath);
  const trimmedYPath = normalizeJsonPath(yJsonPath);

  if (xKindHint === "json" && !trimmedXPath) {
    return {
      data: [],
      series: [],
      error: "请为横轴列提供 JSON Path",
      xKind: xKindHint,
      yKind: yKindHint,
    };
  }

  if (yKindHint === "json" && !trimmedYPath) {
    return {
      data: [],
      series: [],
      error: "请为纵轴列提供 JSON Path",
      xKind: xKindHint,
      yKind: yKindHint,
    };
  }

  const data: Array<Record<string, unknown>> = [];
  let resolvedXPathError: string | null = null;
  let resolvedYPathError: string | null = null;
  let resolvedXPathKind: ColumnKind | null = null;
  let resolvedYPathKind: ColumnKind | null = null;

  for (let i = 0; i < rows.length; i += 1) {
    if (data.length >= normalizedLimit) break;

    const row = rows[i] ?? {};
    let rawX = row[xKey];
    let rawY = row[yKey];

    if (trimmedXPath) {
      const extraction = extractJsonValue(rawX, trimmedXPath);
      if (extraction.error) {
        resolvedXPathError ??= extraction.error;
        continue;
      }
      rawX = extraction.value;
    } else if (xKindHint === "json") {
      const extraction = extractJsonValue(rawX, "");
      if (extraction.error) {
        resolvedXPathError ??= extraction.error;
        continue;
      }
      rawX = extraction.value;
    }

    if (trimmedYPath) {
      const extraction = extractJsonValue(rawY, trimmedYPath);
      if (extraction.error) {
        resolvedYPathError ??= extraction.error;
        continue;
      }
      rawY = extraction.value;
    } else if (yKindHint === "json") {
      const extraction = extractJsonValue(rawY, "");
      if (extraction.error) {
        resolvedYPathError ??= extraction.error;
        continue;
      }
      rawY = extraction.value;
    }

    const parsedX = parseAxisValue(rawX);
    if (parsedX == null) {
      continue;
    }

    const parsedY = parseSeriesValue(rawY);
    if (parsedY == null) {
      continue;
    }

    resolvedXPathKind ??= parsedX.kind;
    resolvedYPathKind ??= parsedY.kind;

    data.push({
      [xKey]: parsedX.value,
      [yKey]: parsedY.value,
    });
  }

  let error: string | null = null;

  if (data.length === 0) {
    if (resolvedYPathError) {
      error = resolvedYPathError;
    } else if (resolvedXPathError) {
      error = resolvedXPathError;
    } else if (yKindHint === "json" || trimmedYPath) {
      error = "未能从 JSON 列中提取可绘制的数据，请检查 JSON Path";
    } else {
      error = yKindHint === "date" ? "所选列没有可解析的日期数据" : "所选列没有可绘制的数值数据";
    }
  } else if (data.length < MIN_POINTS) {
    error = "折线图至少需要三条有效数据点";
  }

  const effectiveYKind = resolvedYPathKind ?? (isSeriesCompatible(yKindHint) ? yKindHint : null);
  const valueFormatter = effectiveYKind === "date" ? (value: number) => formatDateLabel(new Date(value)) : undefined;

  return {
    data,
    series: data.length > 0 ? [{ name: yKey }] : [],
    error,
    valueFormatter,
    xKind: resolvedXPathKind ?? xKindHint,
    yKind: effectiveYKind ?? yKindHint,
  };
}

export function getColumnKinds(rows: Array<Record<string, unknown>>, columns: string[]): Record<string, ColumnKind> {
  const result: Record<string, ColumnKind> = {};
  for (let i = 0; i < columns.length; i += 1) {
    const column = columns[i];
    result[column] = detectColumnKind(rows, column);
  }
  return result;
}

export function detectColumnKind(rows: Array<Record<string, unknown>>, column: string): ColumnKind {
  for (let i = 0; i < rows.length; i += 1) {
    const value = rows[i]?.[column];
    if (value == null) continue;

    if (isNumericLike(value)) {
      return "numeric";
    }

    if (isDateLike(value)) {
      return "date";
    }

     if (isJsonLike(value)) {
       return "json";
     }
  }
  return "other";
}

export function isSeriesCompatible(kind: ColumnKind | undefined): boolean {
  return kind === "numeric" || kind === "date";
}

export function findFirstSeriesColumn(columns: string[], columnKinds: Record<string, ColumnKind>): string | null {
  for (let i = 0; i < columns.length; i += 1) {
    const column = columns[i];
    const kind = columnKinds[column];
    if (kind === "numeric" || kind === "date") {
      return column;
    }
  }
  for (let i = 0; i < columns.length; i += 1) {
    const column = columns[i];
    if (columnKinds[column] === "json") {
      return column;
    }
  }
  return null;
}

function parseSeriesValue(value: unknown): { value: number; kind: ColumnKind } | null {
  const numeric = parseNumeric(value);
  if (numeric != null) {
    return { value: numeric, kind: "numeric" };
  }

  const date = parseDate(value);
  if (date != null) {
    return { value: date.getTime(), kind: "date" };
  }

  return null;
}

function parseAxisValue(value: unknown): { value: string | number; kind: ColumnKind } | null {
  if (value == null) {
    return null;
  }

  const numeric = parseNumeric(value);
  if (numeric != null) {
    return { value: numeric, kind: "numeric" };
  }

  const date = parseDate(value);
  if (date != null) {
    return { value: formatDateLabel(date), kind: "date" };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return { value: trimmed, kind: "other" };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { value: formatDateLabel(value), kind: "date" };
  }

  if (typeof value === "object") {
    try {
      return { value: JSON.stringify(value), kind: "other" };
    } catch {
      return null;
    }
  }

  return { value: String(value), kind: "other" };
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const ts = Date.parse(trimmed);
    if (!Number.isNaN(ts)) {
      const parsed = new Date(ts);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }

  return null;
}

function isNumericLike(value: unknown): boolean {
  return parseNumeric(value) != null;
}

function isDateLike(value: unknown): boolean {
  return parseDate(value) != null;
}

function isJsonLike(value: unknown): boolean {
  if (value == null) return false;
  if (value instanceof Date) return false;
  if (Array.isArray(value)) return true;
  if (typeof value === "object") {
    return true;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        return false;
      }
    }
  }

  return false;
}

function formatDateLabel(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

type JsonPathSegment = { type: "property"; key: string } | { type: "index"; index: number };

export function extractJsonValue(value: unknown, jsonPath: string): { value: unknown; error: string | null } {
  const trimmed = normalizeJsonPath(jsonPath);

  let current: unknown = value;

  if (typeof current === "string") {
    const maybeJson = current.trim();
    if (!maybeJson) {
      return { value: undefined, error: null };
    }
    try {
      current = JSON.parse(maybeJson);
    } catch {
      if (trimmed) {
        return { value: undefined, error: "列值不是有效的 JSON，无法应用 JSON Path" };
      }
      return { value: current, error: null };
    }
  }

  if (!trimmed) {
    return { value: current, error: null };
  }

  const segments = parseJsonPath(trimmed);
  if (!segments) {
    return { value: undefined, error: "JSON Path 格式不正确" };
  }

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment.type === "property") {
      if (current != null && typeof current === "object" && segment.key in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[segment.key];
        continue;
      }
      return { value: undefined, error: null };
    }

    if (segment.type === "index") {
      if (Array.isArray(current)) {
        current = current[segment.index];
        continue;
      }
      return { value: undefined, error: null };
    }
  }

  return { value: current, error: null };
}

function parseJsonPath(path: string): JsonPathSegment[] | null {
  const segments: JsonPathSegment[] = [];
  const regex = /([^.[\]]+)|\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(path)) !== null) {
    const gap = path.slice(lastIndex, match.index);
    if (gap.length > 0) {
      if (gap !== ".") {
        return null;
      }
    }

    if (match[1] != null) {
      segments.push({ type: "property", key: match[1] });
    } else if (match[2] != null) {
      segments.push({ type: "index", index: Number.parseInt(match[2], 10) });
    }

    lastIndex = regex.lastIndex;
  }

  const trailing = path.slice(lastIndex);
  if (trailing.length > 0) {
    if (trailing !== ".") {
      return null;
    }
  }

  return segments;
}

function normalizeJsonPath(path?: string): string {
  if (!path) return "";
  return path.trim();
}

function clampLimit(limit: number, totalRows: number): number {
  const numericLimit = Number.isFinite(limit) ? Math.floor(limit) : totalRows;
  const safeLimit = Math.max(0, Math.min(numericLimit, totalRows));
  return safeLimit;
}
