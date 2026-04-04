import { NextResponse } from "next/server";

import type { IdentifierType, ProductKey } from "@/lib/dashboard-types";
import { runHogQL, sqlLiteral } from "@/lib/posthog";

export const dynamic = "force-dynamic";

type SuggestionRow = {
  identifier_value?: string | null;
};

function identifierExpression(type: IdentifierType) {
  switch (type) {
    case "operationID":
      return "coalesce(nullIf(toString(properties.operationID), ''), nullIf(toString(properties.operationId), ''), '')";
    case "app_name":
      return "toString(properties.app_name)";
    case "page":
      return "coalesce(nullIf(toString(properties.page), ''), nullIf(toString(properties.$pathname), ''), '')";
    case "free_property":
      return "toString(properties.free_property)";
    default:
      return "''";
  }
}

function lowerLike(expression: string, value: string) {
  return `lower(${expression}) LIKE ${sqlLiteral(`%${value.toLowerCase()}%`)}`;
}

function productScope(product: ProductKey) {
  if (product === "watermark") {
    return `(
      ${lowerLike("toString(properties.free_property)", "watermark")}
      OR ${lowerLike("toString(properties.$current_url)", "watermark")}
      OR ${lowerLike("toString(properties.page)", "watermark")}
      OR ${lowerLike("toString(properties.tool_id)", "watermark")}
    )`;
  }

  if (product === "upscale") {
    return `(
      ${lowerLike("toString(properties.free_property)", "upscale")}
      OR ${lowerLike("toString(properties.free_property)", "upscalemedia")}
      OR ${lowerLike("toString(properties.$current_url)", "upscale")}
      OR ${lowerLike("toString(properties.$current_url)", "upscalemedia")}
      OR ${lowerLike("toString(properties.page)", "upscale")}
      OR ${lowerLike("toString(properties.page)", "upscalemedia")}
      OR ${lowerLike("toString(properties.tool_id)", "upscale")}
      OR ${lowerLike("toString(properties.tool_id)", "upscalemedia")}
    )`;
  }

  if (product === "pixelbin") {
    return `(
      ${lowerLike("toString(properties.$current_url)", "/ai-tools/")}
      OR ${lowerLike("toString(properties.$current_url)", "console.pixelbin.io")}
      OR ${lowerLike("toString(properties.$current_url)", "/studio/")}
      OR ${lowerLike("toString(properties.$pathname)", "/ai-tools/")}
      OR ${lowerLike("toString(properties.$pathname)", "/studio/")}
      OR lower(toString(properties.app_name)) IN ('video-generator', 'ai-image-generator', 'ai-image-editor', 'magic-canvas', 'ai-editor')
      OR lower(toString(properties.page)) IN ('ai-video-generator', 'ai-image-generator', 'ai-image-editor', 'studio_ai-editor', 'batch-editor')
      OR lower(toString(properties.free_property)) IN ('watermarkremover', 'video-watermark-remover', 'upscalemedia')
    )`;
  }

  return "1 = 1";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const product = (searchParams.get("product") ?? "pixelbin") as ProductKey;
    const identifierType = (searchParams.get("identifierType") ?? "operationID") as IdentifierType;
    const expression = identifierExpression(identifierType);

    if (expression === "''") {
      return NextResponse.json({ suggestions: [] });
    }

    const query = `
SELECT
  ${expression} AS identifier_value
FROM events
WHERE timestamp >= now() - interval 7 day
  AND length(trim(BOTH ' ' FROM ${expression})) > 0
  AND ${productScope(product)}
GROUP BY identifier_value
ORDER BY count() DESC
LIMIT 25`;

    const rows = await runHogQL<SuggestionRow>(query);

    return NextResponse.json({
      suggestions: rows
        .map((row) => (row.identifier_value ?? "").trim())
        .filter(Boolean),
    });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
