import { describe, expect, it } from "vitest";
import {
  buildLineChartData,
  getColumnKinds,
  findFirstSeriesColumn,
  extractJsonValue,
  ColumnKind,
} from "../chart-utils";

describe("chart-utils", () => {
  const rows = [
    { ts: "2025-09-01", value: 10, secondary: "42", label: "A" },
    { ts: "2025-09-02", value: "12.5", secondary: "44", label: "B" },
    { ts: "2025-09-03", value: 18, secondary: "46", label: "C" },
    { ts: "2025-09-04", value: 20, secondary: null, label: "D" },
  ];

  it("builds chart data with formatted date axis and numeric series", () => {
    const result = buildLineChartData({ rows, xKey: "ts", yKey: "value", limit: 3 });

    expect(result.error).toBeNull();
    expect(result.series).toEqual([{ name: "value" }]);
    expect(result.data).toHaveLength(3);
    expect(typeof result.data[0].ts).toBe("string");
    expect(result.data[0].value).toBe(10);
    expect(result.data[1].value).toBeCloseTo(12.5);
    expect(result.xKind).toBe("date");
    expect(result.yKind).toBe("numeric");
  });

  it("skips rows with invalid series values and reports an error when too few remain", () => {
    const mixedRows = [
      { ts: "2025-09-01", value: "abc" },
      { ts: "2025-09-02", value: null },
      { ts: "2025-09-03", value: 42 },
      { ts: "2025-09-04", value: "100" },
    ];

    const result = buildLineChartData({ rows: mixedRows, xKey: "ts", yKey: "value", limit: 10 });

    expect(result.error).toContain("至少需要三条有效数据点");
    expect(result.data).toHaveLength(2);
    expect(result.data[0].value).toBe(42);
    expect(result.data[1].value).toBe(100);
  });

  it("converts date series to timestamps and exposes a value formatter", () => {
    const dateRows = [
      { ts: "2025-09-01", createdAt: "2025-09-01T10:00:00Z" },
      { ts: "2025-09-02", createdAt: "2025-09-02T10:00:00Z" },
      { ts: "2025-09-03", createdAt: "bad-date" },
      { ts: "2025-09-04", createdAt: "2025-09-04T10:00:00Z" },
    ];

    const result = buildLineChartData({ rows: dateRows, xKey: "ts", yKey: "createdAt", limit: 10 });

    expect(result.error).toBeNull();
    expect(result.valueFormatter).toBeTypeOf("function");
    expect(result.data[0].createdAt).toBeTypeOf("number");
    const formatted = result.valueFormatter?.(result.data[0].createdAt as number);
    expect(formatted).toContain("2025-09-01");
    expect(result.yKind).toBe("date");
  });

  it("respects the provided limit", () => {
    const result = buildLineChartData({ rows, xKey: "ts", yKey: "value", limit: 2 });

    expect(result.data).toHaveLength(2);
  });

  it("detects column kinds and finds the first series column", () => {
    const kinds = getColumnKinds(rows, ["value", "ts", "label"]);
    expect(kinds.value).toBe("numeric");
    expect(kinds.ts).toBe("date");
    expect(kinds.label).toBe("other");

    const firstSeries = findFirstSeriesColumn(["label", "value", "ts"], kinds as Record<string, ColumnKind>);
    expect(firstSeries).toBe("value");
  });

  it("extracts numeric data from JSON columns when JSON Path is provided", () => {
    const jsonRows = [
      { ts: "2025-09-01", payload: { metrics: [{ count: 10 }] } },
      { ts: "2025-09-02", payload: { metrics: [{ count: "12.5" }] } },
      { ts: "2025-09-03", payload: { metrics: [{ count: 15 }] } },
      { ts: "2025-09-04", payload: null },
    ];

    const result = buildLineChartData({
      rows: jsonRows,
      xKey: "ts",
      yKey: "payload",
      limit: 10,
      yJsonPath: "metrics[0].count",
    });

    expect(result.error).toBeNull();
    expect(result.series).toEqual([{ name: "payload" }]);
    expect(result.data).toHaveLength(3);
    expect(result.data[0].payload).toBe(10);
    expect(result.data[1].payload).toBeCloseTo(12.5);
    expect(result.yKind).toBe("numeric");
    expect(typeof result.data[0].ts).toBe("string");
  });

  it("supports JSON path on the horizontal axis", () => {
    const rowsWithJsonAxis = [
      { event: { ts: "2025-09-01T00:00:00Z" }, metric: 1 },
      { event: { ts: "2025-09-02T00:00:00Z" }, metric: 2 },
      { event: { ts: "2025-09-03T00:00:00Z" }, metric: 3 },
    ];

    const result = buildLineChartData({
      rows: rowsWithJsonAxis,
      xKey: "event",
      yKey: "metric",
      limit: 10,
      xJsonPath: "ts",
    });

    expect(result.error).toBeNull();
    expect(result.data[0].event).toContain("2025-09-01");
    expect(result.series).toEqual([{ name: "metric" }]);
  });

  it("reports JSON Path syntax errors", () => {
    const jsonRows = [{ ts: "2025-09-01", payload: { metrics: [{ count: 10 }] } }];

    const result = buildLineChartData({
      rows: jsonRows,
      xKey: "ts",
      yKey: "payload",
      limit: 10,
      yJsonPath: "metrics[[0]",
    });

    expect(result.error).toContain("JSON Path 格式不正确");
    expect(result.data).toHaveLength(0);
  });

  it("extractJsonValue handles nested properties and array indices", () => {
    const source = {
      metrics: [
        { count: 10 },
        { count: 20, details: { ratio: "0.8" } },
      ],
    };

    const first = extractJsonValue(source, "metrics[0].count");
    expect(first.value).toBe(10);
    expect(first.error).toBeNull();

    const ratio = extractJsonValue(source, "metrics[1].details.ratio");
    expect(ratio.value).toBe("0.8");

    const missing = extractJsonValue(source, "metrics[2].count");
    expect(missing.value).toBeUndefined();
    expect(missing.error).toBeNull();
  });
});
