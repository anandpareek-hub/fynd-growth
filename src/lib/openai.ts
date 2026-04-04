type BusinessContextPayload = {
  productDescription?: string;
  icpDescription?: string;
  successFactors?: string;
};

function fallbackRecommendations(scope: string, summaryText: string, businessContext?: BusinessContextPayload) {
  const recommendations = [
    `Prioritize the highest-volume leak in ${scope} first. Use the biggest metric delta or top error-share row as the first engineering fix.`,
    "Review the journey between the main product action and the paywall. If successful outputs happen without paywall exposure, test stronger monetization prompts or better next-step guidance.",
    "Check instrumentation gaps before changing the funnel logic. Missing operation IDs, weak model context, or incomplete payment exposure events can hide the true root cause.",
    "Turn the top failure bucket into a concrete bug ticket with reproduction steps, affected tool scope, user impact, and a target metric to improve after the fix.",
  ];

  if (summaryText.toLowerCase().includes("no discovery")) {
    recommendations.push(
      "Investigate the no-product-discovery segment separately. Add nudges or follow-up CTAs for users who land on step 2 and then produce no meaningful downstream events.",
    );
  }

  if (businessContext?.successFactors?.trim()) {
    recommendations.push(
      `Rank the actions against these success factors: ${businessContext.successFactors.trim().slice(0, 180)}.`,
    );
  }

  return recommendations.slice(0, 6);
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const output = (payload as { output?: unknown[] }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const content = (item as { content?: unknown[] }).content;
      if (!Array.isArray(content)) {
        continue;
      }

      for (const part of content) {
        if (!part || typeof part !== "object") {
          continue;
        }

        const text =
          (part as { text?: unknown }).text ??
          (part as { output_text?: unknown }).output_text ??
          "";
        if (typeof text === "string" && text.trim()) {
          return text.trim();
        }
      }
    }
  }

  return "";
}

function parseRecommendations(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const normalized = trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(normalized) as { recommendations?: string[] };
    return Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((item) => item.trim()).filter(Boolean)
      : [];
  } catch {
    return normalized
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 6);
  }
}

export async function generateRecommendations(
  summaryText: string,
  scope: string,
  businessContext?: BusinessContextPayload,
  payloadSnapshot?: unknown,
) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      recommendations: [
        "Add OPENAI_API_KEY in Vercel to generate tailored actions from the current insight payload.",
      ],
      model: "not-configured",
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are the Fynd growth and product-ops analyst. Return concise, high-signal recommendations as JSON with a top-level recommendations array of 5 to 7 strings. Every recommendation must be directly actionable, tied to the metrics provided, and written so a PM, engineer, or growth owner can act on it immediately. Cover technical fixes, journey leaks, monetization/paywall issues, instrumentation gaps, and experiments when relevant. Do not output vague advice.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Scope: ${scope}

Insight summary:
${summaryText}

Business context:
${JSON.stringify(
                {
                  productDescription: businessContext?.productDescription ?? "",
                  icpDescription: businessContext?.icpDescription ?? "",
                  successFactors: businessContext?.successFactors ?? "",
                },
                null,
                2,
              )}

Payload snapshot:
${JSON.stringify(payloadSnapshot ?? {}, null, 2).slice(0, 8000)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "recommendation_bundle",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              recommendations: {
                type: "array",
                items: { type: "string" },
                minItems: 5,
                maxItems: 7,
              },
            },
            required: ["recommendations"],
          },
        },
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI recommendations failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const parsedRecommendations = parseRecommendations(extractOutputText(payload));

  return {
    recommendations:
      parsedRecommendations.length > 0
        ? parsedRecommendations
        : fallbackRecommendations(scope, summaryText, businessContext),
    model: "gpt-4.1-mini",
  };
}
