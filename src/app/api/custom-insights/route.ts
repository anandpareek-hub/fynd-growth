import { NextResponse } from "next/server";

import { PRODUCT_CONFIGS } from "@/lib/config";
import { resolveComparisonBundle } from "@/lib/date-range";
import type {
  BusinessContextPayload,
} from "@/lib/openai";
import { generateCustomInsightPlan } from "@/lib/openai";
import { runHogQL } from "@/lib/posthog";
import type {
  Callout,
  DashboardPayload,
  DashboardRequest,
  DatePreset,
  ProductKey,
  TableColumn,
  TableRow,
  CustomScope,
  KnowledgeBase,
} from "@/lib/dashboard-types";

export const dynamic = "force-dynamic";

type CustomInsightRequest = {
  product?: ProductKey;
  scope?: CustomScope;
  question?: string;
  preset?: DatePreset;
  comparePreset?: DatePreset | null;
  from?: string | null;
  to?: string | null;
  compareFrom?: string | null;
  compareTo?: string | null;
  businessContext?: BusinessContextPayload;
  knowledgeBase?: KnowledgeBase | null;
};

function toTableValue(value: unknown) {
  if (value == null) {
    return "";
  }

  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return JSON.stringify(value);
}

function titleize(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatMetricValue(value: number) {
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }

  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function buildPayload(args: {
  title: string;
  subtitle: string;
  answerFocus: string;
  description: string;
  query: string;
  rows: Record<string, unknown>[];
}): DashboardPayload {
  const firstRow = args.rows[0] ?? {};
  const columns = Object.keys(firstRow);
  const numericColumns = columns.filter((key) => typeof firstRow[key] === "number");

  const cards =
    args.rows.length === 1
      ? numericColumns.slice(0, 4).map((key) => ({
          id: `custom-${key}`,
          label: titleize(key),
          value: formatMetricValue(Number(firstRow[key] ?? 0)),
          queryKey: "custom-query",
        }))
      : [
          {
            id: "custom-rows",
            label: "Rows returned",
            value: args.rows.length.toString(),
            queryKey: "custom-query",
          },
        ];

  const tableColumns: TableColumn[] = columns.map((key) => ({
    key,
    label: titleize(key),
    align: typeof firstRow[key] === "number" ? "right" : "left",
  }));
  const tableRows: TableRow[] = args.rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toTableValue(value)])),
  );
  const callouts: Callout[] = [
    {
      id: "custom-answer",
      eyebrow: "Generated insight",
      title: args.title,
      body: args.answerFocus,
      tone: "neutral",
      queryKey: "custom-query",
    },
  ];

  return {
    title: args.title,
    subtitle: args.subtitle,
    cards,
    callouts,
    tables: [
      {
        id: "custom-results",
        title: args.description,
        queryKey: "custom-query",
        columns: tableColumns,
        rows: tableRows,
        emptyState: "The generated query returned no rows.",
      },
    ],
    queries: [
      {
        key: "custom-query",
        label: `${args.title} query`,
        description: args.description,
        sql: args.query,
      },
    ],
    summaryText: [
      args.title,
      args.answerFocus,
      args.rows.slice(0, 8).map((row) => JSON.stringify(row)).join("; "),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CustomInsightRequest;
    const product = body.product && body.product in PRODUCT_CONFIGS ? body.product : "pixelbin";
    const question = body.question?.trim();

    if (!question) {
      return NextResponse.json({ error: "question is required." }, { status: 400 });
    }

    const bundle = resolveComparisonBundle({
      preset: body.preset ?? "7d",
      comparePreset: body.comparePreset ?? "7d",
      from: body.from,
      to: body.to,
      compareFrom: body.compareFrom,
      compareTo: body.compareTo,
    } satisfies Pick<
      DashboardRequest,
      "preset" | "comparePreset" | "from" | "to" | "compareFrom" | "compareTo"
    >);

    const plan = await generateCustomInsightPlan({
      question,
      scope: body.scope ?? "funnel",
      productLabel: PRODUCT_CONFIGS[product].label,
      currentWindow: bundle.current,
      comparisonWindow: bundle.comparison,
      businessContext: body.businessContext,
      knowledgeBase: body.knowledgeBase ?? undefined,
    });
    const rows = await runHogQL<Record<string, unknown>>(plan.query);
    const payload = buildPayload({
      title: plan.title,
      subtitle: plan.subtitle,
      answerFocus: plan.answerFocus,
      description: plan.description,
      query: plan.query,
      rows,
    });

    return NextResponse.json({ payload, model: plan.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown custom insight error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
