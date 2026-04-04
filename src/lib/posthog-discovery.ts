import type { ChartBreakdownProperty, ProductKey } from "@/lib/dashboard-types";
import { sqlLiteral } from "@/lib/posthog";

export function lowerLike(expression: string, value: string) {
  return `lower(${expression}) LIKE ${sqlLiteral(`%${value.toLowerCase()}%`)}`;
}

export function productScopeClause(product: ProductKey, alias = "") {
  const prefix = alias ? `${alias}.` : "";

  if (product === "watermark") {
    return `(
      ${lowerLike(`toString(${prefix}properties.free_property)`, "watermark")}
      OR ${lowerLike(`toString(${prefix}properties.$current_url)`, "watermark")}
      OR ${lowerLike(`toString(${prefix}properties.$pathname)`, "watermark")}
      OR ${lowerLike(`toString(${prefix}properties.page)`, "watermark")}
      OR ${lowerLike(`toString(${prefix}properties.tool_id)`, "watermark")}
    )`;
  }

  if (product === "upscale") {
    return `(
      ${lowerLike(`toString(${prefix}properties.free_property)`, "upscale")}
      OR ${lowerLike(`toString(${prefix}properties.free_property)`, "upscalemedia")}
      OR ${lowerLike(`toString(${prefix}properties.$current_url)`, "upscale")}
      OR ${lowerLike(`toString(${prefix}properties.$current_url)`, "upscalemedia")}
      OR ${lowerLike(`toString(${prefix}properties.$pathname)`, "upscale")}
      OR ${lowerLike(`toString(${prefix}properties.$pathname)`, "upscalemedia")}
      OR ${lowerLike(`toString(${prefix}properties.page)`, "upscale")}
      OR ${lowerLike(`toString(${prefix}properties.page)`, "upscalemedia")}
      OR ${lowerLike(`toString(${prefix}properties.tool_id)`, "upscale")}
      OR ${lowerLike(`toString(${prefix}properties.tool_id)`, "upscalemedia")}
    )`;
  }

  if (product === "pixelbin") {
    return `(
      ${lowerLike(`toString(${prefix}properties.$current_url)`, "/ai-tools/")}
      OR ${lowerLike(`toString(${prefix}properties.$pathname)`, "/ai-tools/")}
      OR ${lowerLike(`toString(${prefix}properties.$current_url)`, "pixelbin.io/video-generator")}
      OR ${lowerLike(`toString(${prefix}properties.$pathname)`, "video-generator")}
      OR ${lowerLike(`toString(${prefix}properties.$current_url)`, "/studio/")}
      OR ${lowerLike(`toString(${prefix}properties.$pathname)`, "/studio/")}
      OR lower(toString(${prefix}properties.app_name)) IN ('video-generator', 'ai-image-generator', 'ai-image-editor', 'magic-canvas', 'ai-editor')
      OR lower(toString(${prefix}properties.page)) IN ('ai-video-generator', 'ai-image-generator', 'ai-image-editor', 'studio_ai-editor', 'batch-editor')
      OR lower(toString(${prefix}properties.free_property)) IN ('watermarkremover', 'video-watermark-remover', 'upscalemedia')
    )`;
  }

  return "1 = 1";
}

export function breakdownExpression(property: ChartBreakdownProperty) {
  switch (property) {
    case "appslug":
      return "coalesce(nullIf(toString(properties.appslug), ''), 'Unknown')";
    case "current_url":
      return "coalesce(nullIf(toString(properties.$current_url), ''), nullIf(toString(properties.$pathname), ''), 'Unknown')";
    case "app_name":
      return "coalesce(nullIf(toString(properties.app_name), ''), 'Unknown')";
    case "page":
      return "coalesce(nullIf(toString(properties.page), ''), nullIf(toString(properties.$pathname), ''), 'Unknown')";
    case "slug":
      return "coalesce(nullIf(toString(properties.slug), ''), 'Unknown')";
    case "operationID":
      return "coalesce(nullIf(toString(properties.operationID), ''), nullIf(toString(properties.operationId), ''), 'Unknown')";
    case "free_property":
      return "coalesce(nullIf(toString(properties.free_property), ''), 'Unknown')";
    case "none":
    default:
      return sqlLiteral("All");
  }
}
