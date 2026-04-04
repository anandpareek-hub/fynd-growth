export async function generateRecommendations(summaryText: string, scope: string) {
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
                "You are an expert growth analyst. Return concise, high-signal recommendations as JSON with a top-level recommendations array of 4 to 6 strings. Focus on root-cause analysis, experiments, instrumentation gaps, and practical next actions.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Scope: ${scope}\n\nInsight summary:\n${summaryText}`,
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
                minItems: 4,
                maxItems: 6,
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

  const payload = (await response.json()) as {
    output_text?: string;
  };

  const parsed = JSON.parse(payload.output_text ?? "{\"recommendations\":[]}") as {
    recommendations: string[];
  };

  return {
    recommendations: parsed.recommendations,
    model: "gpt-4.1-mini",
  };
}
