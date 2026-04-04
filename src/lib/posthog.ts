import { POSTHOG_HOST, POSTHOG_PROJECT_ID } from "@/lib/config";

type HogqlResponse = {
  columns?: string[];
  results?: unknown[][];
};

function getApiKey() {
  const key = process.env.POSTHOG_API_KEY;

  if (!key) {
    throw new Error("POSTHOG_API_KEY is not configured.");
  }

  return key;
}

export function sqlLiteral(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function sqlLike(value: string) {
  return `%${value}%`;
}

export async function runHogQL<T extends Record<string, unknown>>(query: string): Promise<T[]> {
  const response = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      query: {
        kind: "HogQLQuery",
        query,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("PostHog query failed", {
      status: response.status,
      body,
      query,
    });
    throw new Error(`PostHog query failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as HogqlResponse;
  const columns = data.columns ?? [];
  const rows = data.results ?? [];

  return rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null])) as T,
  );
}
