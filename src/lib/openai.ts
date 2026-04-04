export type BusinessContextPayload = {
  productDescription?: string;
  icpDescription?: string;
  successFactors?: string;
};

type KnowledgeBaseSummary = {
  summary: string;
  queryNotes: string[];
};

type CustomInsightPlan = {
  title: string;
  subtitle: string;
  description: string;
  answerFocus: string;
  query: string;
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

function parseJsonObject<T>(text: string) {
  const normalized = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(normalized) as T;
}

function ensureReadOnlyQuery(query: string) {
  const normalized = query.trim().replace(/;+$/, "");
  const upper = normalized.toUpperCase();

  if (!(upper.startsWith("SELECT") || upper.startsWith("WITH"))) {
    throw new Error("Custom insight query must start with SELECT or WITH.");
  }

  if (/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i.test(normalized)) {
    throw new Error("Custom insight query must be read-only.");
  }

  return normalized;
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

export async function generateCustomInsightPlan(input: {
  question: string;
  scope: string;
  productLabel: string;
  currentWindow: { from: string; to: string; label: string };
  comparisonWindow?: { from: string; to: string; label: string };
  businessContext?: BusinessContextPayload;
  knowledgeBase?: {
    summary?: string;
    queryNotes?: string[];
    recentEvents?: string[];
    recentApps?: string[];
    recentSlugs?: string[];
    recentPages?: string[];
    recentFreeProperties?: string[];
    recentOperationIds?: string[];
    recentUrls?: string[];
  };
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
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
                "You are the Fynd Growth analytics engineer. Write one read-only HogQL query for PostHog and return JSON only. Use only SELECT or WITH...SELECT. Never mutate data. Query the events table only, but person.properties is allowed when needed. Always apply the provided time window. Keep results under 60 rows. Favor clear aliases. Use event patterns and properties relevant to the requested scope: Funnel and Checkout use pageviews, PAYMENT_POP_UP, LIMIT_POPUP_TRIGGRED, CHECKOUT_INITIATED, paddle_transaction; Product Performance and Errors use failure events plus properties.error, error_message, operationID, app_name, free_property, modelId; Revenue uses paddle_transaction, paddle_event_type='transaction.completed', paddle_unit_price/100, paddle_name, paddle_origin; Acquisition uses landing URLs, referrers, signup events; Retention uses recurring usage or payment activity. If the question implies comparison, include current vs comparison columns in the same query.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Product: ${input.productLabel}
Scope: ${input.scope}
Question: ${input.question}

Current window:
- Label: ${input.currentWindow.label}
- From: ${input.currentWindow.from}
- To: ${input.currentWindow.to}

Comparison window:
- Label: ${input.comparisonWindow?.label ?? ""}
- From: ${input.comparisonWindow?.from ?? ""}
- To: ${input.comparisonWindow?.to ?? ""}

Business context:
${JSON.stringify(
                {
                  productDescription: input.businessContext?.productDescription ?? "",
                  icpDescription: input.businessContext?.icpDescription ?? "",
                  successFactors: input.businessContext?.successFactors ?? "",
                },
                null,
                2,
              )}

Knowledge base:
${JSON.stringify(
                {
                  summary: input.knowledgeBase?.summary ?? "",
                  queryNotes: input.knowledgeBase?.queryNotes ?? [],
                  recentEvents: input.knowledgeBase?.recentEvents ?? [],
                  recentApps: input.knowledgeBase?.recentApps ?? [],
                  recentSlugs: input.knowledgeBase?.recentSlugs ?? [],
                  recentPages: input.knowledgeBase?.recentPages ?? [],
                  recentFreeProperties: input.knowledgeBase?.recentFreeProperties ?? [],
                  recentOperationIds: input.knowledgeBase?.recentOperationIds ?? [],
                  recentUrls: input.knowledgeBase?.recentUrls ?? [],
                },
                null,
                2,
              )}

Return JSON with:
- title
- subtitle
- description
- answerFocus
- query

The query must already include the current window. If you add a comparison, use the comparison window above explicitly in the same query.`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "custom_insight_plan",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              subtitle: { type: "string" },
              description: { type: "string" },
              answerFocus: { type: "string" },
              query: { type: "string" },
            },
            required: ["title", "subtitle", "description", "answerFocus", "query"],
          },
        },
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI custom insight failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const plan = parseJsonObject<CustomInsightPlan>(extractOutputText(payload));

  return {
    ...plan,
    query: ensureReadOnlyQuery(plan.query),
    model: "gpt-4.1-mini",
  };
}

export async function generateKnowledgeBaseSummary(input: {
  productLabel: string;
  eventRows: Array<Record<string, unknown>>;
  recentApps: string[];
  recentSlugs: string[];
  recentPages: string[];
  recentFreeProperties: string[];
  recentOperationIds: string[];
  recentUrls: string[];
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      summary: `Recent ${input.productLabel} schema refresh captured ${input.eventRows.length} event rows across the last 3 days.`,
      queryNotes: [
        "Prefer the freshest recentEvents and recentUrls when building scoped queries.",
        "Use recentOperationIds and recentApps as identifier hints when custom analysis needs a tighter filter.",
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
                "You are the Fynd Growth instrumentation librarian. Summarize recent PostHog schema changes for a single product. Return JSON only. Highlight new or notable events, useful identifiers, URL patterns, and 4-6 concrete query-writing notes the app should remember for future analysis. Keep notes specific and practical.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(input, null, 2).slice(0, 12000),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "knowledge_base_summary",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              queryNotes: {
                type: "array",
                items: { type: "string" },
                minItems: 4,
                maxItems: 6,
              },
            },
            required: ["summary", "queryNotes"],
          },
        },
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI knowledge refresh failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const summary = parseJsonObject<KnowledgeBaseSummary>(extractOutputText(payload));

  return {
    ...summary,
    model: "gpt-4.1-mini",
  };
}
