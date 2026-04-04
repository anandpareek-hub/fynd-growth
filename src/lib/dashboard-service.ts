import {
  FAILURE_IGNORE_PATTERNS,
  IDENTIFIER_LABELS,
  PRODUCT_CONFIGS,
  VIEW_LABELS,
} from "@/lib/config";
import { calculateDelta, formatWindowLabel, resolveComparisonBundle } from "@/lib/date-range";
import type {
  Callout,
  DashboardPayload,
  DashboardRequest,
  IdentifierType,
  InsightQuery,
  MetricCard,
  ProductKey,
  TableRow,
} from "@/lib/dashboard-types";
import { runHogQL, sqlLiteral } from "@/lib/posthog";

type NumericRow = Record<string, number | string | null>;

function percent(value: number) {
  const digits = value === 0 ? 1 : value < 1 ? 2 : 1;
  return `${value.toFixed(digits)}%`;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function sanitizeFreeText(value: string | null | undefined) {
  return normalizeText(value).slice(0, 120);
}

function nonEmptyExpression(expression: string) {
  return `length(trim(BOTH ' ' FROM ${expression})) > 0`;
}

function deltaLabel(current: number, comparison: number) {
  const delta = calculateDelta(current, comparison);
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function deltaTone(current: number, comparison: number) {
  if (current === comparison) {
    return "neutral" as const;
  }

  return current > comparison ? ("positive" as const) : ("negative" as const);
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toStringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function identifierExpression(type: IdentifierType) {
  switch (type) {
    case "slug":
      return "toString(properties.slug)";
    case "appslug":
      return "coalesce(nullIf(toString(properties.appslug), ''), nullIf(toString(properties.appSlug), ''), '')";
    case "plugin":
      return "toString(properties.plugin)";
    case "operationID":
      return "coalesce(nullIf(toString(properties.operationID), ''), nullIf(toString(properties.operationId), ''), '')";
    case "app_name":
      return "toString(properties.app_name)";
    case "free_property":
      return "toString(properties.free_property)";
    case "page":
      return "coalesce(nullIf(toString(properties.page), ''), nullIf(toString(properties.$pathname), ''), '')";
    case "other":
      return "coalesce(nullIf(toString(properties.$current_url), ''), nullIf(toString(properties.page), ''), '')";
    default:
      return "toString(properties.slug)";
  }
}

function lowerLike(propertyExpression: string, text: string) {
  return `lower(${propertyExpression}) LIKE ${sqlLiteral(`%${text.toLowerCase()}%`)}`;
}

function mainToolFilter(text?: string | null) {
  const value = sanitizeFreeText(text);
  if (!value) {
    return "";
  }

  return ` AND (
    ${lowerLike("toString(properties.$current_url)", value)}
    OR ${lowerLike("toString(properties.$pathname)", value)}
    OR ${lowerLike("toString(properties.page)", value)}
    OR ${lowerLike("toString(properties.app_name)", value)}
  )`;
}

function productScope(product: ProductKey) {
  if (product === "watermark") {
    return ` AND (
      ${lowerLike("toString(properties.free_property)", "watermark")}
      OR ${lowerLike("toString(properties.$current_url)", "watermark")}
      OR ${lowerLike("toString(properties.page)", "watermark")}
      OR ${lowerLike("toString(properties.tool_id)", "watermark")}
    )`;
  }

  if (product === "upscale") {
    return ` AND (
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

  return "";
}

function paymentCondition(token?: string | null, alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  const tokenClause = token
    ? ` AND ${lowerLike(`toString(${prefix}properties.paddle_name)`, token)}`
    : "";

  return `${prefix}event='paddle_transaction'
    AND toString(${prefix}properties.paddle_origin)='api'
    AND toString(${prefix}properties.paddle_event_type)='transaction.completed'${tokenClause}`;
}

function paymentPopupCondition(product: ProductKey, alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  if (product === "watermark" || product === "upscale") {
    return `${prefix}event='LIMIT_POPUP_TRIGGRED'`;
  }

  return `${prefix}event='PAYMENT_POP_UP'`;
}

function errorMessageExpression() {
  return `coalesce(
    nullIf(toString(properties.error), ''),
    nullIf(toString(properties.error_message), ''),
    nullIf(toString(properties.errorMessage), ''),
    nullIf(toString(properties.reason), ''),
    nullIf(toString(properties.message), ''),
    nullIf(toString(properties.failure_reason), ''),
    'Unknown'
  )`;
}

function errorDetailExpression() {
  return `coalesce(
    nullIf(toString(properties.error_details), ''),
    nullIf(toString(properties.details), ''),
    nullIf(toString(properties.detail), ''),
    ''
  )`;
}

function modelExpression() {
  return `coalesce(
    nullIf(toString(properties.model_id), ''),
    nullIf(toString(properties.modelId), ''),
    nullIf(toString(properties.model), ''),
    ''
  )`;
}

function promptExpression() {
  return `coalesce(
    nullIf(toString(properties.prompt), ''),
    nullIf(toString(properties.user_prompt), ''),
    nullIf(toString(properties.input_prompt), ''),
    nullIf(toString(properties.text), ''),
    ''
  )`;
}

function inputExpression() {
  return `coalesce(
    nullIf(toString(properties.inputs), ''),
    nullIf(toString(properties.input), ''),
    nullIf(toString(properties.payload), ''),
    ''
  )`;
}

function failureFilter() {
  const ignore = FAILURE_IGNORE_PATTERNS.map((pattern) =>
    `lower(${errorMessageExpression()}) NOT LIKE ${sqlLiteral(`%${pattern}%`)}`,
  );

  return `(
    lower(event) LIKE '%failed%'
    OR lower(event) LIKE '%error%'
    OR lower(${errorMessageExpression()}) LIKE '%fail%'
    OR lower(${errorMessageExpression()}) LIKE '%error%'
  ) AND ${ignore.join(" AND ")}`;
}

function revenueExpression() {
  return "toFloatOrZero(toString(properties.paddle_unit_price)) / 100";
}

function planExpression() {
  return `coalesce(
    nullIf(toString(properties.paddle_name), ''),
    nullIf(toString(properties.plan_name), ''),
    nullIf(toString(properties.plan), ''),
    'Unknown'
  )`;
}

function summaryText(title: string, cards: MetricCard[], callouts: Callout[], tables: { title: string; rows: TableRow[] }[]) {
  const cardLine = cards.map((card) => `${card.label}: ${card.value}${card.delta ? ` (${card.delta})` : ""}`).join(" | ");
  const calloutLine = callouts.map((callout) => `${callout.title}: ${callout.body}`).join(" | ");
  const tableLine = tables
    .map((table) => `${table.title}: ${table.rows.slice(0, 4).map((row) => JSON.stringify(row)).join("; ")}`)
    .join(" | ");

  return [title, cardLine, calloutLine, tableLine].filter(Boolean).join("\n");
}

function addQuery(queries: InsightQuery[], key: string, label: string, description: string, sql: string) {
  queries.push({ key, label, description, sql });
}

function mapRowsBy<T extends NumericRow>(rows: T[], key: keyof T) {
  return new Map(rows.map((row) => [toStringValue(row[key]), row]));
}

type ToolMapping = {
  product: ProductKey;
  key: string;
  aliases: string[];
  firstEvent: string;
  seoUrlContains?: string;
  consoleUrlContains: string;
  popupEvent: "PAYMENT_POP_UP" | "LIMIT_POPUP_TRIGGRED";
  appName?: string;
  slug?: string;
  freeProperty?: string;
};

const TOOL_MAPPINGS: ToolMapping[] = [
  {
    product: "pixelbin",
    key: "video-generator",
    aliases: ["video-generator", "studio/video-generator"],
    firstEvent: "DYNAMIC_APP_VIDEO_GENERATION_CLICKED",
    seoUrlContains: "ai-tools/video-generator",
    consoleUrlContains: "studio/video-generator",
    popupEvent: "PAYMENT_POP_UP",
    appName: "video-generator",
    slug: "video-generator",
  },
  {
    product: "pixelbin",
    key: "ai-image-generator",
    aliases: ["ai-image-generator", "studio/ai-image-generator"],
    firstEvent: "IMG_TO_IMG_GENERATE_CLICKED",
    seoUrlContains: "ai-tools/ai-image-generator",
    consoleUrlContains: "studio/ai-image-generator",
    popupEvent: "PAYMENT_POP_UP",
    appName: "ai-image-generator",
    slug: "ai-image-generator",
  },
  {
    product: "pixelbin",
    key: "ai-image-editor",
    aliases: ["ai-image-editor", "studio/ai-image-editor"],
    firstEvent: "IMG_TO_IMG_GENERATE_CLICKED",
    seoUrlContains: "ai-tools/ai-image-editor",
    consoleUrlContains: "studio/ai-image-editor",
    popupEvent: "PAYMENT_POP_UP",
    appName: "ai-image-editor",
    slug: "ai-image-editor",
  },
  {
    product: "pixelbin",
    key: "magic-canvas",
    aliases: ["magic-canvas", "studio/magic-canvas"],
    firstEvent: "IMG_TO_IMG_GENERATE_CLICKED",
    seoUrlContains: "ai-tools/magic-canvas",
    consoleUrlContains: "studio/magic-canvas",
    popupEvent: "PAYMENT_POP_UP",
    appName: "magic-canvas",
    slug: "magic-canvas",
  },
  {
    product: "watermark",
    key: "watermarkremover",
    aliases: ["watermarkremover", "video-watermark-remover", "mini-studio/watermarkremover"],
    firstEvent: "IMAGE_TRANSFORMED",
    consoleUrlContains: "mini-studio/watermarkremover",
    popupEvent: "LIMIT_POPUP_TRIGGRED",
    freeProperty: "watermarkremover",
  },
  {
    product: "upscale",
    key: "upscalemedia",
    aliases: ["upscalemedia", "image-upscaler", "mini-studio/upscaler"],
    firstEvent: "IMAGE_TRANSFORMED",
    consoleUrlContains: "mini-studio/upscaler",
    popupEvent: "LIMIT_POPUP_TRIGGRED",
    freeProperty: "upscalemedia",
  },
];

function aliasPrefix(alias?: string) {
  return alias ? `${alias}.` : "";
}

function exactLower(expression: string, value: string) {
  return `lower(${expression}) = ${sqlLiteral(value.toLowerCase())}`;
}

function truncateText(value: string, max = 160) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function parseJsonValue(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function simplifyErrorValue(rawValue: string) {
  const normalized = normalizeText(rawValue);
  if (!normalized) {
    return "Unknown";
  }

  const parsed = parseJsonValue(normalized);
  if (parsed && typeof parsed === "object") {
    const candidate = firstString([
      (parsed as { error?: unknown }).error,
      (parsed as { message?: unknown }).message,
      (parsed as { error_message?: unknown }).error_message,
      (parsed as { reason?: unknown }).reason,
    ]);

    if (candidate) {
      return truncateText(candidate, 120);
    }
  }

  return truncateText(normalized, 120);
}

function extractErrorDetails(rawValue: string, explicitDetails: string) {
  const normalizedDetails = normalizeText(explicitDetails);
  if (normalizedDetails) {
    return truncateText(normalizedDetails, 180);
  }

  const normalizedRaw = normalizeText(rawValue);
  if (!normalizedRaw) {
    return "";
  }

  const parsed = parseJsonValue(normalizedRaw);
  if (parsed && typeof parsed === "object") {
    const details = (parsed as { details?: unknown; error_details?: unknown; detail?: unknown }).details
      ?? (parsed as { error_details?: unknown }).error_details
      ?? (parsed as { detail?: unknown }).detail;

    if (typeof details === "string" && details.trim()) {
      return truncateText(details.trim(), 180);
    }

    if (details && typeof details === "object") {
      return truncateText(JSON.stringify(details), 180);
    }
  }

  return "";
}

function resolveToolMapping(product: ProductKey, value?: string | null, consoleUrl?: string | null) {
  const candidates = [value, consoleUrl]
    .map((item) => sanitizeFreeText(item).toLowerCase())
    .filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  return (
    TOOL_MAPPINGS.find(
      (mapping) =>
        mapping.product === product &&
        candidates.some((candidate) =>
          mapping.aliases.some((alias) => candidate === alias || candidate.includes(alias) || alias.includes(candidate)),
        ),
    ) ?? null
  );
}

function mappingScopeCondition(mapping: ToolMapping, alias?: string) {
  const prefix = aliasPrefix(alias);
  const conditions: string[] = [];

  if (mapping.appName) {
    conditions.push(exactLower(`toString(${prefix}properties.app_name)`, mapping.appName));
  }

  if (mapping.slug) {
    conditions.push(exactLower(`toString(${prefix}properties.slug)`, mapping.slug));
  }

  if (mapping.freeProperty) {
    conditions.push(exactLower(`toString(${prefix}properties.free_property)`, mapping.freeProperty));
  }

  if (mapping.consoleUrlContains) {
    conditions.push(lowerLike(`toString(${prefix}properties.$current_url)`, mapping.consoleUrlContains));
    conditions.push(lowerLike(`toString(${prefix}properties.$pathname)`, mapping.consoleUrlContains));
  }

  if (mapping.seoUrlContains) {
    conditions.push(lowerLike(`toString(${prefix}properties.$current_url)`, mapping.seoUrlContains));
    conditions.push(lowerLike(`toString(${prefix}properties.$pathname)`, mapping.seoUrlContains));
  }

  return conditions.length ? `(${conditions.join(" OR ")})` : "1 = 1";
}

function mappedPopupCondition(mapping: ToolMapping, alias?: string) {
  const prefix = aliasPrefix(alias);
  return `${prefix}event='${mapping.popupEvent}' AND ${mappingScopeCondition(mapping, alias)}`;
}

function withIdentifierFilter(type: IdentifierType | null | undefined, value: string | null | undefined) {
  if (!type) {
    return "";
  }

  const normalized = sanitizeFreeText(value);
  if (!normalized) {
    return "";
  }

  return ` AND lower(${identifierExpression(type)}) = ${sqlLiteral(normalized.toLowerCase())}`;
}

function withStepUrl(stepUrl: string | null | undefined, fallback: string, alias = "e") {
  const normalized = sanitizeFreeText(stepUrl || fallback);
  const prefix = alias ? `${alias}.` : "";
  return lowerLike(`toString(${prefix}properties.$current_url)`, normalized);
}

function buildSeoFunnelQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType: IdentifierType;
  identifierValue?: string | null;
  mainTool?: string | null;
  stepUrl?: string | null;
}) {
  const config = PRODUCT_CONFIGS[args.product];
  const mapping = resolveToolMapping(args.product, args.identifierValue, args.stepUrl ?? args.mainTool);
  const identifierExpr = identifierExpression(args.identifierType);
  const identifierFilter = withIdentifierFilter(args.identifierType, args.identifierValue);
  const scope = productScope(args.product);
  const mainToolClause = mainToolFilter(args.mainTool);
  const paymentClause = paymentCondition(config.revenueToken);

  if (mapping && args.identifierValue) {
    const stepOneClause = `event='${mapping.firstEvent}' AND ${mappingScopeCondition(mapping)}`;
    const stepTwoClause =
      mapping.popupEvent === "LIMIT_POPUP_TRIGGRED"
        ? mappedPopupCondition(mapping)
        : `event='$pageview' AND ${mappingScopeCondition(mapping)} AND ${lowerLike("toString(properties.$current_url)", mapping.consoleUrlContains)}`;

    return `
WITH step1 AS (
  SELECT
    person_id AS actor_id,
    min(timestamp) AS step1_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND ${stepOneClause}
  GROUP BY actor_id
),
actor_rollup AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${stepTwoClause}) AS step2_ts,
    minIf(timestamp, ${paymentClause}) AS step3_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND (${stepTwoClause} OR ${paymentClause})
  GROUP BY actor_id
)
SELECT
  ${sqlLiteral(mapping.key)} AS identifier_value,
  ${sqlLiteral(mapping.firstEvent)} AS first_event,
  uniqExact(s1.actor_id) AS step1_users,
  uniqExactIf(
    s1.actor_id,
    r.step2_ts > toDateTime('1970-01-01 00:00:00')
    AND r.step2_ts >= s1.step1_ts
  ) AS step2_users,
  uniqExactIf(
    s1.actor_id,
    r.step2_ts > toDateTime('1970-01-01 00:00:00')
    AND r.step3_ts > toDateTime('1970-01-01 00:00:00')
    AND r.step2_ts >= s1.step1_ts
    AND r.step3_ts >= r.step2_ts
  ) AS step3_users
FROM step1 s1
LEFT JOIN actor_rollup r ON r.actor_id = s1.actor_id`;
  }

  const stepTwoClause =
    args.product === "watermark" || args.product === "upscale"
      ? paymentPopupCondition(args.product)
      : `event='$pageview' AND ${withStepUrl(args.stepUrl, config.stepTwoDefault, "")}`;

  return `
WITH step1 AS (
  SELECT
    person_id AS actor_id,
    ${identifierExpr} AS identifier_value,
    min(timestamp) AS step1_ts,
    argMin(event, timestamp) AS first_event
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND ${nonEmptyExpression(identifierExpr)}
    ${identifierFilter}
    ${scope}
    ${mainToolClause}
  GROUP BY actor_id, identifier_value
),
actor_rollup AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${stepTwoClause}) AS step2_ts,
    minIf(timestamp, ${paymentClause}) AS step3_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND (${stepTwoClause} OR ${paymentClause})
  GROUP BY actor_id
)
SELECT
  s1.identifier_value AS identifier_value,
  any(s1.first_event) AS first_event,
  uniqExact(s1.actor_id) AS step1_users,
  uniqExactIf(
    s1.actor_id,
    r.step2_ts > toDateTime('1970-01-01 00:00:00')
    AND r.step2_ts >= s1.step1_ts
  ) AS step2_users,
  uniqExactIf(
    s1.actor_id,
    r.step2_ts > toDateTime('1970-01-01 00:00:00')
    AND r.step3_ts > toDateTime('1970-01-01 00:00:00')
    AND r.step2_ts >= s1.step1_ts
    AND r.step3_ts >= r.step2_ts
  ) AS step3_users
FROM step1 s1
LEFT JOIN actor_rollup r ON r.actor_id = s1.actor_id
GROUP BY s1.identifier_value
ORDER BY step1_users DESC
LIMIT 25`;
}

function buildConsoleQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  consoleUrl: string;
}) {
  const config = PRODUCT_CONFIGS[args.product];
  const mapping = resolveToolMapping(args.product, args.consoleUrl, args.consoleUrl);
  const stepOneCondition = mapping
    ? `event='$pageview' AND ${mappingScopeCondition(mapping)} AND ${lowerLike("toString(properties.$current_url)", mapping.consoleUrlContains)}`
    : `event='$pageview' AND ${lowerLike("toString(properties.$current_url)", args.consoleUrl)}`;
  const popupCondition = mapping ? mappedPopupCondition(mapping) : paymentPopupCondition(args.product);
  const paymentClause = paymentCondition(config.revenueToken);

  return `
WITH actor_rollup AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${stepOneCondition}) AS step1_ts,
    minIf(timestamp, ${popupCondition}) AS step2_ts,
    minIf(timestamp, ${paymentClause}) AS step3_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND (${stepOneCondition} OR ${popupCondition} OR ${paymentClause})
  GROUP BY actor_id
)
SELECT
  uniqExactIf(actor_id, step1_ts > toDateTime('1970-01-01 00:00:00')) AS step1_users,
  uniqExactIf(
    actor_id,
    step1_ts > toDateTime('1970-01-01 00:00:00')
    AND step2_ts > toDateTime('1970-01-01 00:00:00')
    AND step2_ts >= step1_ts
  ) AS step2_users,
  uniqExactIf(
    actor_id,
    step1_ts > toDateTime('1970-01-01 00:00:00')
    AND step2_ts > toDateTime('1970-01-01 00:00:00')
    AND step3_ts > toDateTime('1970-01-01 00:00:00')
    AND step2_ts >= step1_ts
    AND step3_ts >= step2_ts
  ) AS step3_users
FROM actor_rollup`;
}

function buildPerformanceErrorsQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType?: IdentifierType | null;
  identifierValue?: string | null;
}) {
  const scope = productScope(args.product);
  const identifierFilter = withIdentifierFilter(args.identifierType, args.identifierValue);

  return `
SELECT
  ${errorMessageExpression()} AS raw_error,
  ${errorDetailExpression()} AS error_details,
  any(event) AS event_name,
  any(${modelExpression()}) AS model_id,
  count() AS error_count,
  uniqExact(person_id) AS impacted_users
FROM events
WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
  AND timestamp < toDateTime(${sqlLiteral(args.to)})
  AND ${failureFilter()}
  ${scope}
  ${identifierFilter}
GROUP BY raw_error, error_details
ORDER BY error_count DESC
LIMIT 40`;
}

function buildPerformanceRollupQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType?: IdentifierType | null;
  identifierValue?: string | null;
}) {
  const scope = productScope(args.product);
  const identifierFilter = withIdentifierFilter(args.identifierType, args.identifierValue);
  const popupCondition = paymentPopupCondition(args.product);

  return `
WITH scoped_users AS (
  SELECT uniqExact(person_id) AS total_users
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    ${scope}
    ${identifierFilter}
),
failed_users AS (
  SELECT
    person_id AS actor_id
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND ${failureFilter()}
    ${scope}
    ${identifierFilter}
  GROUP BY actor_id
),
popup_users AS (
  SELECT
    person_id AS actor_id
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND ${popupCondition}
  GROUP BY actor_id
)
SELECT
  (SELECT total_users FROM scoped_users) AS total_users,
  uniqExact(f.actor_id) AS impacted_users,
  uniqExactIf(f.actor_id, p.actor_id IS NULL) AS dropped_before_paywall
FROM failed_users f
LEFT JOIN popup_users p ON p.actor_id = f.actor_id`;
}

function buildPerformanceContextQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType?: IdentifierType | null;
  identifierValue?: string | null;
}) {
  const scope = productScope(args.product);
  const identifierFilter = withIdentifierFilter(args.identifierType, args.identifierValue);

  return `
SELECT
  event AS event_name,
  any(${modelExpression()}) AS model_id,
  any(${promptExpression()}) AS prompt_sample,
  any(${inputExpression()}) AS input_sample,
  count() AS sample_count
FROM events
WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
  AND timestamp < toDateTime(${sqlLiteral(args.to)})
  AND (${modelExpression()} != '' OR ${promptExpression()} != '' OR ${inputExpression()} != '')
  ${scope}
  ${identifierFilter}
GROUP BY event_name
ORDER BY sample_count DESC
LIMIT 10`;
}

function buildRevenueSummaryQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
}) {
  const token = PRODUCT_CONFIGS[args.product].revenueToken;

  return `
SELECT
  sum(${revenueExpression()}) AS total_revenue,
  count() AS total_payments,
  uniqExact(person_id) AS buyers
FROM events
WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
  AND timestamp < toDateTime(${sqlLiteral(args.to)})
  AND ${paymentCondition(token)}`;
}

function buildRevenuePlansQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
}) {
  const token = PRODUCT_CONFIGS[args.product].revenueToken;

  return `
SELECT
  ${planExpression()} AS plan_name,
  sum(${revenueExpression()}) AS revenue,
  count() AS payments,
  uniqExact(person_id) AS buyers
FROM events
WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
  AND timestamp < toDateTime(${sqlLiteral(args.to)})
  AND ${paymentCondition(token)}
GROUP BY plan_name
ORDER BY revenue DESC
LIMIT 12`;
}

function buildRevenueAttributionQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
}) {
  const token = PRODUCT_CONFIGS[args.product].revenueToken;

  return `
WITH tx AS (
  SELECT
    person_id AS buyer_id,
    sum(${revenueExpression()}) AS revenue,
    count() AS payments
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND ${paymentCondition(token)}
  GROUP BY buyer_id
),
usage AS (
  SELECT
    e.person_id AS buyer_id,
    multiIf(
      ${lowerLike("toString(e.properties.app_name)", "video-generator")} OR ${lowerLike("toString(e.properties.$current_url)", "video-generator")}, 'Video Generator',
      ${lowerLike("toString(e.properties.app_name)", "ai-image-generator")} OR ${lowerLike("toString(e.properties.slug)", "ai-image-generator")}, 'AI Image Generator',
      ${lowerLike("toString(e.properties.app_name)", "ai-image-editor")} OR ${lowerLike("toString(e.properties.$current_url)", "ai-image-editor")}, 'AI Image Editor',
      ${lowerLike("toString(e.properties.page)", "studio_ai-editor")} AND (${lowerLike("toString(e.properties.tool_id)", "watermark")} OR ${lowerLike("toString(e.properties.prompt)", "watermark")}), 'Watermark remover',
      ${lowerLike("toString(e.properties.page)", "studio_ai-editor")} AND (${lowerLike("toString(e.properties.tool_id)", "upscale")} OR ${lowerLike("toString(e.properties.prompt)", "upscale")}), 'Upscale media',
      ${lowerLike("toString(e.properties.page)", "batch-editor")} OR ${lowerLike("toString(e.properties.$current_url)", "batch-editor")}, 'Batch Editor',
      'Other'
    ) AS tool_bucket,
    count() AS usage_events
  FROM events e
  INNER JOIN tx ON tx.buyer_id = e.person_id
  WHERE e.timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND e.timestamp < toDateTime(${sqlLiteral(args.to)})
  GROUP BY buyer_id, tool_bucket
),
primary_usage AS (
  SELECT
    buyer_id,
    argMax(tool_bucket, usage_events) AS primary_tool
  FROM usage
  GROUP BY buyer_id
)
SELECT
  coalesce(primary_tool, 'Unattributed') AS primary_tool,
  sum(tx.revenue) AS revenue,
  sum(tx.payments) AS payments,
  count() AS buyers
FROM tx
LEFT JOIN primary_usage pu ON pu.buyer_id = tx.buyer_id
GROUP BY primary_tool
ORDER BY revenue DESC
LIMIT 10`;
}

function buildNoDiscoveryQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType: IdentifierType;
  identifierValue: string;
  stepUrl?: string | null;
}) {
  const config = PRODUCT_CONFIGS[args.product];
  const identifierFilter = withIdentifierFilter(args.identifierType, args.identifierValue);

  return `
WITH step1 AS (
  SELECT
    person_id AS actor_id,
    min(timestamp) AS step1_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    ${identifierFilter}
    ${productScope(args.product)}
  GROUP BY actor_id
),
actor_rollup AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, event='$pageview' AND ${withStepUrl(args.stepUrl, config.stepTwoDefault, "")}) AS step2_ts,
    countIf(event != '$pageview') AS follow_events
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
  GROUP BY actor_id
)
SELECT
  uniqExactIf(
    s.actor_id,
    r.step2_ts > toDateTime('1970-01-01 00:00:00')
    AND r.step2_ts >= s.step1_ts
  ) AS reached_step2,
  uniqExactIf(
    s.actor_id,
    r.step2_ts > toDateTime('1970-01-01 00:00:00')
    AND r.step2_ts >= s.step1_ts
    AND r.follow_events = 0
  ) AS no_discovery_users
FROM step1 s
LEFT JOIN actor_rollup r ON r.actor_id = s.actor_id`;
}

async function buildSeoFunnelsPayload(request: DashboardRequest): Promise<DashboardPayload> {
  const bundle = resolveComparisonBundle(request);
  const config = PRODUCT_CONFIGS[request.product];
  const identifierType = request.identifierType ?? config.funnelIdentifierTypes[0];
  const queries: InsightQuery[] = [];
  const currentSql = buildSeoFunnelQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    identifierType,
    identifierValue: request.identifierValue,
    mainTool: request.mainTool,
    stepUrl: request.stepUrl,
  });
  const compareSql = buildSeoFunnelQuery({
    product: request.product,
    from: bundle.comparison.from,
    to: bundle.comparison.to,
    identifierType,
    identifierValue: request.identifierValue,
    mainTool: request.mainTool,
    stepUrl: request.stepUrl,
  });

  addQuery(queries, "seo-current", "Current SEO funnel query", "Person-linked funnel from first identifier touch to studio landing to paddle conversion.", currentSql);
  addQuery(queries, "seo-comparison", "Comparison SEO funnel query", "Same funnel logic for the comparison period.", compareSql);

  const [currentRows, comparisonRows] = await Promise.all([
    runHogQL<NumericRow>(currentSql),
    runHogQL<NumericRow>(compareSql),
  ]);

  const comparisonMap = mapRowsBy(comparisonRows, "identifier_value");
  const rows = currentRows.map((row) => {
    const key = toStringValue(row.identifier_value);
    const previous = comparisonMap.get(key);
    return {
      identifier: key,
      firstEvent: toStringValue(row.first_event),
      step1: toNumber(row.step1_users),
      step2: toNumber(row.step2_users),
      step3: toNumber(row.step3_users),
      step1Delta: deltaLabel(toNumber(row.step1_users), previous ? toNumber(previous.step1_users) : 0),
      step3Delta: deltaLabel(toNumber(row.step3_users), previous ? toNumber(previous.step3_users) : 0),
      conversion: percent(
        toNumber(row.step1_users) === 0 ? 0 : (toNumber(row.step3_users) / toNumber(row.step1_users)) * 100,
      ),
    };
  });

  const displayRows = request.consolidate
    ? [
        {
          identifier: "All selected identifiers",
          firstEvent: "Mixed first touches",
          step1: rows.reduce((sum, row) => sum + row.step1, 0),
          step2: rows.reduce((sum, row) => sum + row.step2, 0),
          step3: rows.reduce((sum, row) => sum + row.step3, 0),
          step1Delta: deltaLabel(
            rows.reduce((sum, row) => sum + row.step1, 0),
            comparisonRows.reduce((sum, row) => sum + toNumber(row.step1_users), 0),
          ),
          step3Delta: deltaLabel(
            rows.reduce((sum, row) => sum + row.step3, 0),
            comparisonRows.reduce((sum, row) => sum + toNumber(row.step3_users), 0),
          ),
          conversion: percent(
            rows.reduce((sum, row) => sum + row.step1, 0) === 0
              ? 0
              : (rows.reduce((sum, row) => sum + row.step3, 0) /
                  rows.reduce((sum, row) => sum + row.step1, 0)) *
                  100,
          ),
        },
      ]
    : rows;

  const totalStep1 = displayRows.reduce((sum, row) => sum + row.step1, 0);
  const totalStep3 = displayRows.reduce((sum, row) => sum + row.step3, 0);
  const totalCompareStep1 = comparisonRows.reduce((sum, row) => sum + toNumber(row.step1_users), 0);
  const totalCompareStep3 = comparisonRows.reduce((sum, row) => sum + toNumber(row.step3_users), 0);

  const cards: MetricCard[] = [
    {
      id: "seo-step1",
      label: "First-touch users",
      value: compactNumber(totalStep1),
      delta: deltaLabel(totalStep1, totalCompareStep1),
      deltaTone: deltaTone(totalStep1, totalCompareStep1),
      hint: bundle.current.label,
      queryKey: "seo-current",
    },
    {
      id: "seo-payments",
      label: "Paid users",
      value: compactNumber(totalStep3),
      delta: deltaLabel(totalStep3, totalCompareStep3),
      deltaTone: deltaTone(totalStep3, totalCompareStep3),
      hint: "Reached paddle transaction",
      queryKey: "seo-current",
    },
    {
      id: "seo-conversion",
      label: "End-to-end conversion",
      value: percent(totalStep1 === 0 ? 0 : (totalStep3 / totalStep1) * 100),
      hint: `${formatWindowLabel(bundle.current.from, bundle.current.to)} vs ${formatWindowLabel(bundle.comparison.from, bundle.comparison.to)}`,
      queryKey: "seo-current",
    },
  ];

  const callouts: Callout[] = [
    {
      id: "seo-takeaway",
      eyebrow: "What to do",
      title: "Sort the funnel table by step 1 volume first",
      body: "The biggest impact usually comes from the identifiers already producing traffic. Use the detailed page on the highest-volume row to inspect failure drag and no-discovery leakage before expanding to smaller tools.",
      tone: "neutral",
      queryKey: "seo-current",
    },
  ];

  return {
    title: `${config.label} SEO funnels`,
    subtitle: `First identifier touch -> ${config.stepTwoDefault === "studio" ? "studio landing" : "limit popup"} -> paddle transaction.`,
    cards,
    callouts,
    tables: [
      {
        id: "seo-funnels",
        title: request.identifierValue
          ? `${IDENTIFIER_LABELS[identifierType]}: ${request.identifierValue}`
          : `Top ${IDENTIFIER_LABELS[identifierType]} funnels`,
        description: `Current period: ${bundle.current.label}. Comparison: ${bundle.comparison.label}.`,
        queryKey: "seo-current",
        columns: [
          { key: "identifier", label: IDENTIFIER_LABELS[identifierType] },
          { key: "firstEvent", label: "First event" },
          { key: "step1", label: "Step 1", align: "right" },
          { key: "step2", label: "Step 2", align: "right" },
          { key: "step3", label: "Step 3", align: "right" },
          { key: "conversion", label: "Conversion", align: "right" },
          { key: "step3Delta", label: "Vs compare", align: "right" },
        ],
        rows: displayRows,
        emptyState: "No funnel data matched this configuration in PostHog.",
      },
    ],
    queries,
    summaryText: summaryText(`${config.label} SEO funnels`, cards, callouts, [{ title: "SEO funnel rows", rows: displayRows }]),
  };
}

async function buildConsoleFunnelsPayload(request: DashboardRequest): Promise<DashboardPayload> {
  const bundle = resolveComparisonBundle(request);
  const config = PRODUCT_CONFIGS[request.product];
  const consoleUrl = sanitizeFreeText(request.consoleUrl || request.stepUrl || config.defaultConsoleUrl);
  const queries: InsightQuery[] = [];

  const currentSql = buildConsoleQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    consoleUrl,
  });
  const compareSql = buildConsoleQuery({
    product: request.product,
    from: bundle.comparison.from,
    to: bundle.comparison.to,
    consoleUrl,
  });

  addQuery(queries, "console-current", "Current console funnel query", "Console landing to popup to paddle conversion.", currentSql);
  addQuery(queries, "console-comparison", "Comparison console funnel query", "Same console funnel for the comparison period.", compareSql);

  const [currentRows, comparisonRows] = await Promise.all([
    runHogQL<NumericRow>(currentSql),
    runHogQL<NumericRow>(compareSql),
  ]);
  const current = currentRows[0] ?? {};
  const comparison = comparisonRows[0] ?? {};

  const step1 = toNumber(current.step1_users);
  const step2 = toNumber(current.step2_users);
  const step3 = toNumber(current.step3_users);
  const compareStep1 = toNumber(comparison.step1_users);
  const compareStep3 = toNumber(comparison.step3_users);

  const cards: MetricCard[] = [
    {
      id: "console-step1",
      label: "Console visitors",
      value: compactNumber(step1),
      delta: deltaLabel(step1, compareStep1),
      deltaTone: deltaTone(step1, compareStep1),
      hint: consoleUrl,
      queryKey: "console-current",
    },
    {
      id: "console-step3",
      label: "Paid users",
      value: compactNumber(step3),
      delta: deltaLabel(step3, compareStep3),
      deltaTone: deltaTone(step3, compareStep3),
      hint: "Reached paddle transaction",
      queryKey: "console-current",
    },
    {
      id: "console-conversion",
      label: "Console conversion",
      value: percent(step1 === 0 ? 0 : (step3 / step1) * 100),
      hint: `${bundle.current.label} vs ${bundle.comparison.label}`,
      queryKey: "console-current",
    },
  ];

  const rows = [
    { stage: "Landing", users: step1, share: "100%" },
    { stage: request.product === "pixelbin" ? "Payment popup" : "Limit popup", users: step2, share: percent(step1 === 0 ? 0 : (step2 / step1) * 100) },
    { stage: "Paddle transaction", users: step3, share: percent(step1 === 0 ? 0 : (step3 / step1) * 100) },
  ];

  const callouts: Callout[] = [
    {
      id: "console-read",
      eyebrow: "Interpretation",
      title: "Use this view to isolate paywall friction",
      body: request.product === "pixelbin"
        ? "This console funnel shows whether studio visitors are seeing the payment popup but not completing paddle checkout."
        : "For Watermarkremover and Upscale Media, the limit popup is the paywall. If it fires often but paddle stays flat, pricing or offer clarity is the likely issue.",
      tone: "neutral",
      queryKey: "console-current",
    },
  ];

  return {
    title: `${config.label} console funnel`,
    subtitle: `Tracking ${consoleUrl} with a fixed three-step console flow.`,
    cards,
    tables: [
      {
        id: "console-table",
        title: "Stage progression",
        queryKey: "console-current",
        columns: [
          { key: "stage", label: "Stage" },
          { key: "users", label: "Users", align: "right" },
          { key: "share", label: "Share of landing users", align: "right" },
        ],
        rows,
      },
    ],
    callouts,
    queries,
    summaryText: summaryText(`${config.label} console funnel`, cards, callouts, [{ title: "Console stages", rows }]),
  };
}

async function buildPerformancePayload(request: DashboardRequest): Promise<DashboardPayload> {
  const bundle = resolveComparisonBundle(request);
  const config = PRODUCT_CONFIGS[request.product];
  const queries: InsightQuery[] = [];

  const errorsSql = buildPerformanceErrorsQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    identifierType: request.identifierType,
    identifierValue: request.identifierValue,
  });
  const rollupSql = buildPerformanceRollupQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    identifierType: request.identifierType,
    identifierValue: request.identifierValue,
  });
  const rollupCompareSql = buildPerformanceRollupQuery({
    product: request.product,
    from: bundle.comparison.from,
    to: bundle.comparison.to,
    identifierType: request.identifierType,
    identifierValue: request.identifierValue,
  });
  const contextSql = buildPerformanceContextQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    identifierType: request.identifierType,
    identifierValue: request.identifierValue,
  });

  addQuery(queries, "perf-errors", "Failure breakdown query", "Top actionable error messages after filtering out credit and rate-limit noise.", errorsSql);
  addQuery(queries, "perf-rollup", "Performance rollup query", "Impacted users and paywall drop after first actionable failure.", rollupSql);
  addQuery(queries, "perf-rollup-compare", "Comparison performance rollup query", "Same performance rollup for the previous comparison period.", rollupCompareSql);
  addQuery(queries, "perf-context", "Failure context query", "Pulls sample model, prompt, and input payload context to help debugging.", contextSql);

  const [errorRows, rollupRows, comparisonRows, contextRows] = await Promise.all([
    runHogQL<NumericRow>(errorsSql),
    runHogQL<NumericRow>(rollupSql),
    runHogQL<NumericRow>(rollupCompareSql),
    runHogQL<NumericRow>(contextSql),
  ]);
  const rollup = rollupRows[0] ?? {};
  const compare = comparisonRows[0] ?? {};

  const totalUsers = toNumber(rollup.total_users);
  const impactedUsers = toNumber(rollup.impacted_users);
  const droppedBeforePaywall = toNumber(rollup.dropped_before_paywall);
  const compareImpacted = toNumber(compare.impacted_users);

  const totalErrors = errorRows.reduce((sum, row) => sum + toNumber(row.error_count), 0);
  let running = 0;
  const topContributors = errorRows.filter((row) => {
    running += toNumber(row.error_count);
    return totalErrors === 0 ? false : running / totalErrors <= 0.8 || running === toNumber(row.error_count);
  });

  const cards: MetricCard[] = [
    {
      id: "perf-impacted",
      label: "Impacted users",
      value: compactNumber(impactedUsers),
      delta: deltaLabel(impactedUsers, compareImpacted),
      deltaTone: deltaTone(impactedUsers, compareImpacted),
      hint: totalUsers ? `${percent((impactedUsers / totalUsers) * 100)} of scoped users` : "No scoped user count",
      queryKey: "perf-rollup",
    },
    {
      id: "perf-errors",
      label: "Actionable failure events",
      value: compactNumber(totalErrors),
      hint: "Credit and rate-limit noise excluded",
      queryKey: "perf-errors",
    },
    {
      id: "perf-drop",
      label: "Users dropping before paywall",
      value: compactNumber(droppedBeforePaywall),
      hint: impactedUsers ? `${percent((droppedBeforePaywall / impactedUsers) * 100)} of impacted users` : "No impacted users",
      queryKey: "perf-rollup",
    },
  ];

  const callouts: Callout[] = [
    {
      id: "perf-rootcause",
      eyebrow: "Investigation path",
      title: "Start with the 80% error bucket",
      body: topContributors.length
        ? `The highest-contributing actionable messages already cover most failures. Fixing the first ${Math.min(3, topContributors.length)} messages should remove the majority of user pain before deeper long-tail cleanup.`
        : "No actionable failure rows were returned for this scope. Check whether the identifier filters are too narrow.",
      tone: "neutral",
      queryKey: "perf-errors",
    },
  ];

  const errorTableRows = topContributors.map((row) => ({
    event: toStringValue(row.event_name),
    error: simplifyErrorValue(toStringValue(row.raw_error)),
    details: extractErrorDetails(toStringValue(row.raw_error), toStringValue(row.error_details)) || "n/a",
    modelId: toStringValue(row.model_id) || "n/a",
    failures: toNumber(row.error_count),
    impactedUsers: toNumber(row.impacted_users),
    share: totalErrors === 0 ? "0%" : percent((toNumber(row.error_count) / totalErrors) * 100),
  }));

  const contextTableRows = contextRows.map((row) => ({
    event: toStringValue(row.event_name),
    modelId: toStringValue(row.model_id) || "n/a",
    prompt: toStringValue(row.prompt_sample).slice(0, 120) || "n/a",
    input: toStringValue(row.input_sample).slice(0, 120) || "n/a",
    samples: toNumber(row.sample_count),
  }));

  return {
    title: `${config.label} product performance`,
    subtitle: request.identifierValue
      ? `Investigating ${request.identifierType ? IDENTIFIER_LABELS[request.identifierType] : "identifier"} = ${request.identifierValue}.`
      : "Actionable failure trends for the selected product scope.",
    cards,
    tables: [
      {
        id: "perf-error-table",
        title: "Top actionable error messages",
        description: "Rows shown until they cover roughly 80% of filtered failures.",
        queryKey: "perf-errors",
        columns: [
          { key: "event", label: "Event" },
          { key: "error", label: "Error" },
          { key: "details", label: "Error details" },
          { key: "modelId", label: "Model" },
          { key: "failures", label: "Failures", align: "right" },
          { key: "impactedUsers", label: "Impacted users", align: "right" },
          { key: "share", label: "Error share", align: "right" },
        ],
        rows: errorTableRows,
        emptyState: "No actionable failure messages matched the current scope.",
      },
      {
        id: "perf-context-table",
        title: "Sample model, prompt, and input context",
        description: "Useful for debugging broken flows and model-specific regressions.",
        queryKey: "perf-context",
        columns: [
          { key: "event", label: "Event" },
          { key: "modelId", label: "Model ID" },
          { key: "prompt", label: "Prompt sample" },
          { key: "input", label: "Input sample" },
          { key: "samples", label: "Sample count", align: "right" },
        ],
        rows: contextTableRows,
        emptyState: "No model or prompt context was found for this filter set.",
      },
    ],
    callouts,
    queries,
    summaryText: summaryText(`${config.label} product performance`, cards, callouts, [
      { title: "Top actionable errors", rows: errorTableRows },
      { title: "Context rows", rows: contextTableRows },
    ]),
  };
}

async function buildRevenuePayload(request: DashboardRequest): Promise<DashboardPayload> {
  const bundle = resolveComparisonBundle(request);
  const config = PRODUCT_CONFIGS[request.product];
  const queries: InsightQuery[] = [];

  const summarySql = buildRevenueSummaryQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
  });
  const compareSql = buildRevenueSummaryQuery({
    product: request.product,
    from: bundle.comparison.from,
    to: bundle.comparison.to,
  });
  const plansSql = buildRevenuePlansQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
  });
  const attributionSql = buildRevenueAttributionQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
  });

  addQuery(queries, "rev-summary", "Revenue summary query", "Total revenue, payments, and buyers from paddle_transaction API events.", summarySql);
  addQuery(queries, "rev-summary-compare", "Comparison revenue summary query", "Same revenue rollup for the comparison period.", compareSql);
  addQuery(queries, "rev-plans", "Revenue by plan query", "Plan-level revenue mix based on paddle names.", plansSql);
  addQuery(queries, "rev-attribution", "Revenue attribution query", "Attributes buyer revenue to their dominant tool usage within the period.", attributionSql);

  const [summaryRows, compareRows, planRows, attributionRows] = await Promise.all([
    runHogQL<NumericRow>(summarySql),
    runHogQL<NumericRow>(compareSql),
    runHogQL<NumericRow>(plansSql),
    runHogQL<NumericRow>(attributionSql),
  ]);

  const summary = summaryRows[0] ?? {};
  const comparison = compareRows[0] ?? {};
  const totalRevenue = toNumber(summary.total_revenue);
  const totalPayments = toNumber(summary.total_payments);
  const buyers = toNumber(summary.buyers);
  const compareRevenue = toNumber(comparison.total_revenue);
  const comparePayments = toNumber(comparison.total_payments);

  const cards: MetricCard[] = [
    {
      id: "rev-total",
      label: "Total revenue",
      value: currency(totalRevenue),
      delta: deltaLabel(totalRevenue, compareRevenue),
      deltaTone: deltaTone(totalRevenue, compareRevenue),
      hint: bundle.current.label,
      queryKey: "rev-summary",
    },
    {
      id: "rev-payments",
      label: "Payments",
      value: compactNumber(totalPayments),
      delta: deltaLabel(totalPayments, comparePayments),
      deltaTone: deltaTone(totalPayments, comparePayments),
      hint: buyers ? `${buyers} buyers` : "No buyers",
      queryKey: "rev-summary",
    },
    {
      id: "rev-aov",
      label: "Revenue per payment",
      value: currency(totalPayments === 0 ? 0 : totalRevenue / totalPayments),
      hint: "Based only on paddle API transactions",
      queryKey: "rev-summary",
    },
  ];

  const planRowsMapped = planRows.map((row) => ({
    plan: toStringValue(row.plan_name),
    revenue: currency(toNumber(row.revenue)),
    payments: toNumber(row.payments),
    buyers: toNumber(row.buyers),
  }));
  const attributionMapped = attributionRows.map((row) => ({
    tool: toStringValue(row.primary_tool),
    revenue: currency(toNumber(row.revenue)),
    payments: toNumber(row.payments),
    buyers: toNumber(row.buyers),
    contribution: totalRevenue === 0 ? "0%" : percent((toNumber(row.revenue) / totalRevenue) * 100),
  }));

  const callouts: Callout[] = [
    {
      id: "rev-guide",
      eyebrow: "Interpretation",
      title: "Use the attribution table to prioritize monetization work",
      body: "The highest-revenue tool buckets are where checkout friction or output quality regressions will hurt the most. Keep paddle as the single source of truth and use this attribution only to rank where to investigate next.",
      tone: "neutral",
      queryKey: "rev-attribution",
    },
  ];

  return {
    title: request.product === "revenue" ? "Revenue insights" : `${config.label} revenue insights`,
    subtitle: config.revenueToken
      ? `Paddle revenue filtered to plans containing ${config.revenueToken}.`
      : "Cross-product revenue view using all paddle API transactions.",
    cards,
    tables: [
      {
        id: "rev-plan-table",
        title: "Revenue by plan",
        queryKey: "rev-plans",
        columns: [
          { key: "plan", label: "Plan" },
          { key: "revenue", label: "Revenue", align: "right" },
          { key: "payments", label: "Payments", align: "right" },
          { key: "buyers", label: "Buyers", align: "right" },
        ],
        rows: planRowsMapped,
      },
      {
        id: "rev-attribution-table",
        title: "Primary tool attribution",
        description: "Buyer revenue grouped by their dominant in-period usage.",
        queryKey: "rev-attribution",
        columns: [
          { key: "tool", label: "Tool" },
          { key: "revenue", label: "Revenue", align: "right" },
          { key: "payments", label: "Payments", align: "right" },
          { key: "buyers", label: "Buyers", align: "right" },
          { key: "contribution", label: "Revenue share", align: "right" },
        ],
        rows: attributionMapped,
      },
    ],
    callouts,
    queries,
    summaryText: summaryText(`${config.label} revenue insights`, cards, callouts, [
      { title: "Plan mix", rows: planRowsMapped },
      { title: "Attribution", rows: attributionMapped },
    ]),
  };
}

async function buildFunnelDetailPayload(request: DashboardRequest): Promise<DashboardPayload> {
  const identifierValue = sanitizeFreeText(request.identifierValue);
  const identifierType = request.identifierType ?? PRODUCT_CONFIGS[request.product].funnelIdentifierTypes[0];
  const basePayload = await buildSeoFunnelsPayload({ ...request, identifierType, identifierValue });
  const bundle = resolveComparisonBundle(request);
  const queries = [...basePayload.queries];

  const noDiscoverySql = buildNoDiscoveryQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    identifierType,
    identifierValue,
    stepUrl: request.stepUrl,
  });
  addQuery(queries, "detail-no-discovery", "No discovery query", "Users who hit step 2 but produced no follow-on activity.", noDiscoverySql);

  const noDiscoveryRows = await runHogQL<NumericRow>(noDiscoverySql);
  const noDiscovery = noDiscoveryRows[0] ?? {};
  const reachedStep2 = toNumber(noDiscovery.reached_step2);
  const noDiscoveryUsers = toNumber(noDiscovery.no_discovery_users);

  const detailCallouts: Callout[] = [
    {
      id: "detail-positive",
      eyebrow: "Why it moved",
      title: "Positive change usually comes from either more first touches or cleaner post-signup activation",
      body: "Compare the step 1 and step 2 deltas together. If step 1 grew but conversion stayed flat, acquisition improved. If step 2 and step 3 grew faster than step 1, the product experience likely got stronger.",
      tone: "neutral",
      queryKey: "seo-current",
    },
    {
      id: "detail-discovery",
      eyebrow: "Watch-out",
      title: "No-product-discovery users deserve a dedicated follow-up",
      body: reachedStep2
        ? `${percent((noDiscoveryUsers / reachedStep2) * 100)} of users who reached step 2 had no follow-on activity. That usually points to weak product discovery, unclear next steps, or missing nudges after sign-up.`
        : "No step-2 users were detected, so no-product-discovery could not be measured for this range.",
      tone: noDiscoveryUsers > 0 ? "negative" : "neutral",
      queryKey: "detail-no-discovery",
    },
  ];

  const cards = [
    ...basePayload.cards,
    {
      id: "detail-no-discovery-card",
      label: "No discovery users",
      value: compactNumber(noDiscoveryUsers),
      hint: reachedStep2 ? `${percent((noDiscoveryUsers / reachedStep2) * 100)} of step 2 users` : "No step 2 users",
      queryKey: "detail-no-discovery",
    },
  ];

  return {
    title: `${PRODUCT_CONFIGS[request.product].label} funnel detail`,
    subtitle: `${IDENTIFIER_LABELS[identifierType]} = ${identifierValue}`,
    cards,
    tables: basePayload.tables,
    callouts: [...basePayload.callouts, ...detailCallouts],
    queries,
    summaryText: summaryText(`${PRODUCT_CONFIGS[request.product].label} funnel detail`, cards, detailCallouts, basePayload.tables.map((table) => ({ title: table.title, rows: table.rows }))),
  };
}

export async function getDashboardPayload(request: DashboardRequest): Promise<DashboardPayload> {
  switch (request.view) {
    case "console-funnels":
      return buildConsoleFunnelsPayload(request);
    case "product-performance":
      return buildPerformancePayload(request);
    case "revenue-insights":
      return buildRevenuePayload(request);
    case "funnel-detail":
      return buildFunnelDetailPayload(request);
    case "seo-funnels":
    default:
      return buildSeoFunnelsPayload(request);
  }
}

export function getDashboardHeader(request: DashboardRequest) {
  const config = PRODUCT_CONFIGS[request.product];
  return {
    appName: "Fynd - Growth",
    section: config.label,
    viewLabel: VIEW_LABELS[request.view],
    description: config.description,
  };
}
