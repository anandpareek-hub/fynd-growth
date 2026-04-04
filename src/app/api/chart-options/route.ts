import { NextResponse } from "next/server";

import type { ProductKey } from "@/lib/dashboard-types";
import { runHogQL } from "@/lib/posthog";
import { productScopeClause } from "@/lib/posthog-discovery";

export const dynamic = "force-dynamic";

type EventOptionRow = {
  event_name?: string | null;
  event_count?: number | null;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const product = (searchParams.get("product") ?? "pixelbin") as ProductKey;

    const query = `
SELECT
  event AS event_name,
  count() AS event_count
FROM events
WHERE timestamp >= now() - interval 30 day
  AND ${productScopeClause(product)}
GROUP BY event_name
ORDER BY event_count DESC
LIMIT 40`;

    const rows = await runHogQL<EventOptionRow>(query);

    return NextResponse.json({
      events: rows.map((row) => String(row.event_name ?? "")).filter(Boolean),
    });
  } catch {
    return NextResponse.json({ events: [] });
  }
}
