import { NextResponse } from "next/server";

import { PRODUCT_CONFIGS } from "@/lib/config";
import { resolveComparisonBundle } from "@/lib/date-range";
import type {
  ChartBreakdownProperty,
  ChartFrequency,
  ChartPayload,
  ChartSeries,
  ChartType,
  DashboardRequest,
  DatePreset,
  ProductKey,
} from "@/lib/dashboard-types";
import { runHogQL, sqlLiteral } from "@/lib/posthog";
import { breakdownExpression, productScopeClause } from "@/lib/posthog-discovery";

export const dynamic = "force-dynamic";

type ChartRequest = {
  product?: ProductKey;
  events?: string[];
  breakdownProperty?: ChartBreakdownProperty;
  chartType?: ChartType;
  preset?: DatePreset;
  from?: string | null;
  to?: string | null;
  frequency?: ChartFrequency;
};

type ChartRow = {
  bucket?: string | null;
  series_name?: string | null;
  value?: number | null;
};

function bucketExpression(frequency: ChartFrequency) {
  if (frequency === "monthly") {
    return "toStartOfMonth(timestamp)";
  }

  if (frequency === "weekly") {
    return "toStartOfWeek(timestamp, 1)";
  }

  return "toStartOfDay(timestamp)";
}

function formatBucket(bucket: string, frequency: ChartFrequency) {
  if (frequency === "monthly") {
    return bucket.slice(0, 7);
  }

  return bucket.slice(0, 10);
}

function seriesLabelExpression(hasBreakdown: boolean, events: string[]) {
  if (!hasBreakdown) {
    return "event";
  }

  if (events.length === 1) {
    return "breakdown_value";
  }

  return "concat(event, ' • ', breakdown_value)";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChartRequest;
    const product = body.product && body.product in PRODUCT_CONFIGS ? body.product : "pixelbin";
    const events = Array.from(new Set((body.events ?? []).map((eventName) => eventName.trim()).filter(Boolean))).slice(0, 8);

    if (!events.length) {
      return NextResponse.json({ error: "Select at least one event." }, { status: 400 });
    }

    const frequency = body.frequency ?? "daily";
    const chartType = body.chartType ?? "line";
    const breakdownProperty = body.breakdownProperty ?? "none";
    const bundle = resolveComparisonBundle({
      preset: body.preset ?? "30d",
      comparePreset: null,
      from: body.from,
      to: body.to,
    } satisfies Pick<DashboardRequest, "preset" | "comparePreset" | "from" | "to">);

    const eventsSql = events.map((eventName) => sqlLiteral(eventName)).join(", ");
    const breakdownSql = breakdownExpression(breakdownProperty);
    const hasBreakdown = breakdownProperty !== "none";
    const seriesSql = seriesLabelExpression(hasBreakdown, events);

    const query = `
WITH base AS (
  SELECT
    ${bucketExpression(frequency)} AS bucket,
    event,
    ${breakdownSql} AS breakdown_value
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(bundle.current.from)})
    AND timestamp < toDateTime(${sqlLiteral(bundle.current.to)})
    AND event IN (${eventsSql})
    AND ${productScopeClause(product)}
)
SELECT
  toString(bucket) AS bucket,
  ${seriesSql} AS series_name,
  count() AS value
FROM base
GROUP BY bucket, series_name
ORDER BY bucket ASC, series_name ASC`;

    const rows = await runHogQL<ChartRow>(query);
    const labels = Array.from(new Set(rows.map((row) => formatBucket(String(row.bucket ?? ""), frequency)).filter(Boolean)));
    const bySeries = new Map<string, Map<string, number>>();

    for (const row of rows) {
      const seriesName = String(row.series_name ?? "Unknown");
      const bucket = formatBucket(String(row.bucket ?? ""), frequency);
      const value = Number(row.value ?? 0);
      if (!bySeries.has(seriesName)) {
        bySeries.set(seriesName, new Map<string, number>());
      }
      bySeries.get(seriesName)?.set(bucket, value);
    }

    const rankedSeries = Array.from(bySeries.entries())
      .map(([name, bucketMap]) => ({
        name,
        bucketMap,
        total: Array.from(bucketMap.values()).reduce((sum, value) => sum + value, 0),
      }))
      .sort((left, right) => right.total - left.total)
      .slice(0, 8);

    const series: ChartSeries[] = rankedSeries.map(({ name, bucketMap }) => {
      let runningTotal = 0;
      let rawTotal = 0;
      const points = labels.map((label) => {
        const rawValue = bucketMap.get(label) ?? 0;
        rawTotal += rawValue;
        const value = chartType === "cumulative-line" ? (runningTotal += rawValue) : rawValue;
        return { label, value };
      });

      return {
        name,
        points,
        total: chartType === "cumulative-line" ? rawTotal : points.reduce((sum, point) => sum + point.value, 0),
      };
    });

    const payload: ChartPayload = {
      title: `${PRODUCT_CONFIGS[product].label} charts`,
      subtitle: `${events.length} selected event${events.length > 1 ? "s" : ""} • ${bundle.current.label}`,
      chartType,
      frequency,
      labels,
      series,
      summary: `Showing ${series.length} series across ${labels.length} ${frequency} buckets.`,
      query: {
        key: "chart-query",
        label: "Chart query",
        description: "Saved chart query generated from the selected event, breakdown, and time controls.",
        sql: query,
      },
    };

    return NextResponse.json({ payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build chart.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
