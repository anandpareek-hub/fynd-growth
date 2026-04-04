import { NextResponse } from "next/server";

import { generateRecommendations } from "@/lib/openai";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      summaryText?: string;
      scope?: string;
      businessContext?: {
        productDescription?: string;
        icpDescription?: string;
        successFactors?: string;
      };
      payloadSnapshot?: unknown;
    };

    const summaryText = body.summaryText?.trim();
    const scope = body.scope?.trim() || "dashboard";

    if (!summaryText) {
      return NextResponse.json({ error: "summaryText is required." }, { status: 400 });
    }

    const result = await generateRecommendations(summaryText, scope, body.businessContext, body.payloadSnapshot);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown recommendations error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
