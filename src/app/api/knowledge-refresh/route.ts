import { NextResponse } from "next/server";

import { PRODUCT_CONFIGS } from "@/lib/config";
import type { KnowledgeBase, ProductKey } from "@/lib/dashboard-types";
import { generateKnowledgeBaseSummary } from "@/lib/openai";
import { runHogQL } from "@/lib/posthog";
import { productScopeClause } from "@/lib/posthog-discovery";

export const dynamic = "force-dynamic";

type EventRow = {
  event_name?: string | null;
  event_count?: number | null;
  sample_url?: string | null;
  app_name?: string | null;
  slug?: string | null;
  free_property?: string | null;
  operation_id?: string | null;
};

type ValueRow = {
  value?: string | null;
};

async function listValues(product: ProductKey, expression: string) {
  const query = `
SELECT
  ${expression} AS value
FROM events
WHERE timestamp >= now() - interval 3 day
  AND ${productScopeClause(product)}
  AND length(${expression}) > 0
GROUP BY value
ORDER BY count() DESC
LIMIT 24`;

  const rows = await runHogQL<ValueRow>(query);
  return rows.map((row) => String(row.value ?? "")).filter(Boolean);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { product?: ProductKey };
    const product = body.product && body.product in PRODUCT_CONFIGS ? body.product : "pixelbin";

    const eventQuery = `
SELECT
  event AS event_name,
  count() AS event_count,
  anyIf(toString(properties.$current_url), length(toString(properties.$current_url)) > 0) AS sample_url,
  anyIf(toString(properties.app_name), length(toString(properties.app_name)) > 0) AS app_name,
  anyIf(toString(properties.slug), length(toString(properties.slug)) > 0) AS slug,
  anyIf(toString(properties.free_property), length(toString(properties.free_property)) > 0) AS free_property,
  anyIf(coalesce(nullIf(toString(properties.operationID), ''), nullIf(toString(properties.operationId), '')), length(coalesce(nullIf(toString(properties.operationID), ''), nullIf(toString(properties.operationId), ''))) > 0) AS operation_id
FROM events
WHERE timestamp >= now() - interval 3 day
  AND ${productScopeClause(product)}
GROUP BY event_name
ORDER BY event_count DESC
LIMIT 60`;

    const [eventRows, recentApps, recentSlugs, recentPages, recentFreeProperties, recentOperationIds, recentUrls] =
      await Promise.all([
        runHogQL<EventRow>(eventQuery),
        listValues(product, "toString(properties.app_name)"),
        listValues(product, "toString(properties.slug)"),
        listValues(product, "coalesce(nullIf(toString(properties.page), ''), nullIf(toString(properties.$pathname), ''))"),
        listValues(product, "toString(properties.free_property)"),
        listValues(product, "coalesce(nullIf(toString(properties.operationID), ''), nullIf(toString(properties.operationId), ''))"),
        listValues(product, "coalesce(nullIf(toString(properties.$current_url), ''), nullIf(toString(properties.$pathname), ''))"),
      ]);

    const knowledgeSummary = await generateKnowledgeBaseSummary({
      productLabel: PRODUCT_CONFIGS[product].label,
      eventRows,
      recentApps,
      recentSlugs,
      recentPages,
      recentFreeProperties,
      recentOperationIds,
      recentUrls,
    }).catch(() => ({
      summary: `Recent ${PRODUCT_CONFIGS[product].label} knowledge refresh captured ${eventRows.length} events from the last 3 days.`,
      queryNotes: [
        "Use recent event names and URL patterns before falling back to older hard-coded mappings.",
        "Check recent operation IDs and app names before filtering Product Performance queries.",
      ],
      model: "fallback",
    }));

    const knowledgeBase: KnowledgeBase = {
      product,
      generatedAt: new Date().toISOString(),
      model: knowledgeSummary.model,
      summary: knowledgeSummary.summary,
      queryNotes: knowledgeSummary.queryNotes,
      recentEvents: eventRows.map((row) => String(row.event_name ?? "")).filter(Boolean),
      recentApps,
      recentSlugs,
      recentPages,
      recentFreeProperties,
      recentOperationIds,
      recentUrls,
    };

    return NextResponse.json({ knowledgeBase });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Knowledge refresh failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
