import { NextResponse } from "next/server";

import { PRODUCT_CONFIGS } from "@/lib/config";
import { getDashboardHeader, getDashboardPayload } from "@/lib/dashboard-service";
import type { DashboardRequest, DatePreset, IdentifierType, ProductKey, ViewKey } from "@/lib/dashboard-types";

export const dynamic = "force-dynamic";

const PRODUCT_KEYS = Object.keys(PRODUCT_CONFIGS) as ProductKey[];
const VIEW_KEYS: ViewKey[] = ["seo-funnels", "console-funnels", "product-performance", "revenue-insights", "funnel-detail"];
const PRESETS: DatePreset[] = ["24h", "7d", "30d", "custom"];

function pickProduct(value: string | null): ProductKey {
  return PRODUCT_KEYS.includes(value as ProductKey) ? (value as ProductKey) : "pixelbin";
}

function pickView(value: string | null, product: ProductKey): ViewKey {
  const fallback = PRODUCT_CONFIGS[product].views[0];
  if (!value) {
    return fallback;
  }

  return VIEW_KEYS.includes(value as ViewKey) ? (value as ViewKey) : fallback;
}

function pickPreset(value: string | null): DatePreset {
  return PRESETS.includes(value as DatePreset) ? (value as DatePreset) : "7d";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const product = pickProduct(searchParams.get("product"));
  const view = pickView(searchParams.get("view"), product);

  const dashboardRequest: DashboardRequest = {
    product,
    view,
    preset: pickPreset(searchParams.get("preset")),
    comparePreset: searchParams.get("comparePreset") ? pickPreset(searchParams.get("comparePreset")) : null,
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    compareFrom: searchParams.get("compareFrom"),
    compareTo: searchParams.get("compareTo"),
    identifierType: searchParams.get("identifierType") as IdentifierType | null,
    identifierValue: searchParams.get("identifierValue"),
    mainTool: searchParams.get("mainTool"),
    stepUrl: searchParams.get("stepUrl"),
    consoleUrl: searchParams.get("consoleUrl"),
    consolidate: searchParams.get("consolidate") === "true",
  };

  try {
    const payload = await getDashboardPayload(dashboardRequest);

    return NextResponse.json({
      header: getDashboardHeader(dashboardRequest),
      payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown dashboard error.";
    const status = message.includes("POSTHOG_API_KEY") ? 200 : 500;

    return NextResponse.json(
      {
        error: message,
        header: getDashboardHeader(dashboardRequest),
      },
      { status },
    );
  }
}
