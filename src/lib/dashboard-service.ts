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
  if (product === "pixelbin") {
    return ` AND (
      ${lowerLike("toString(properties.$current_url)", "/ai-tools/")}
      OR ${lowerLike("toString(properties.$current_url)", "console.pixelbin.io")}
      OR ${lowerLike("toString(properties.$current_url)", "/studio/")}
      OR ${lowerLike("toString(properties.$pathname)", "/ai-tools/")}
      OR ${lowerLike("toString(properties.$pathname)", "/studio/")}
      OR lower(toString(properties.app_name)) IN ('video-generator', 'ai-image-generator', 'ai-image-editor', 'magic-canvas', 'ai-editor')
      OR lower(toString(properties.page)) IN ('ai-video-generator', 'ai-image-generator', 'ai-image-editor', 'studio_ai-editor', 'batch-editor')
      OR lower(toString(properties.free_property)) IN ('watermarkremover', 'video-watermark-remover', 'upscalemedia')
      OR length(trim(BOTH ' ' FROM coalesce(nullIf(toString(properties.operationID), ''), nullIf(toString(properties.operationId), ''), ''))) > 0
    )`;
  }

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

function productRevenueClause(productOrToken?: ProductKey | string | null, alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  const nameExpression = `toString(${prefix}properties.paddle_name)`;

  switch (productOrToken) {
    case "pixelbin":
    case "PB":
      return ` AND (
        ${lowerLike(nameExpression, "PB ")}
        OR ${lowerLike(nameExpression, "Pixelbin")}
      )`;
    case "watermark":
    case "WM":
      return ` AND (
        ${lowerLike(nameExpression, "WM ")}
        OR ${lowerLike(nameExpression, "watermark")}
        OR ${lowerLike(nameExpression, "WatermarkRemover")}
      )`;
    case "upscale":
    case "UM":
      return ` AND (
        ${lowerLike(nameExpression, "UM ")}
        OR ${lowerLike(nameExpression, "upscale")}
      )`;
    case "revenue":
    case null:
    case undefined:
      return "";
    default:
      return ` AND ${lowerLike(nameExpression, String(productOrToken))}`;
  }
}

/**
 * Exclude test accounts (@gofynd.com) from HogQL queries.
 * Matches PostHog's filterTestAccounts: true behaviour.
 */
function testAccountFilter(alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  return `AND NOT ilike(toString(${prefix}person.properties.email), '%@gofynd.com%')`;
}

/**
 * Conversion window constraint: step must occur within 14 days of the anchor.
 */
function conversionWindow(stepTs: string, anchorTs: string) {
  return `${stepTs} >= ${anchorTs} AND ${stepTs} <= ${anchorTs} + INTERVAL 14 DAY`;
}

/**
 * Paddle UTM clause to scope payment attribution to a specific product/tool.
 * Uses paddle_utm (the attribution tag set at checkout time).
 */
function paddleUtmClause(product: ProductKey, mapping: ToolMapping | null, alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  const utmExpr = `toString(${prefix}properties.paddle_utm)`;

  if (mapping) {
    // Use the mapping's app_name or key for precise utm matching
    const utmValue = mapping.appName ?? mapping.key;
    return ` AND lower(${utmExpr}) LIKE ${sqlLiteral(`%${utmValue.toLowerCase()}%`)}`;
  }

  // Fallback to product-level paddle_name matching
  switch (product) {
    case "pixelbin":
      return ` AND (${lowerLike(utmExpr, "video-generator")} OR ${lowerLike(utmExpr, "ai-image-generator")} OR ${lowerLike(utmExpr, "image-editor")} OR ${lowerLike(utmExpr, "magic-canvas")})`;
    case "watermark":
      return ` AND (${lowerLike(utmExpr, "watermark")} OR ${lowerLike(`toString(${prefix}properties.paddle_name)`, "WM ")} OR ${lowerLike(`toString(${prefix}properties.paddle_name)`, "watermark")})`;
    case "upscale":
      return ` AND (${lowerLike(utmExpr, "upscale")} OR ${lowerLike(`toString(${prefix}properties.paddle_name)`, "UM ")} OR ${lowerLike(`toString(${prefix}properties.paddle_name)`, "upscale")})`;
    default:
      return "";
  }
}

function paymentCondition(
  productOrToken?: ProductKey | string | null,
  alias?: string,
  options?: {
    apiOnly?: boolean;
    includeProductFilter?: boolean;
  },
) {
  const prefix = alias ? `${alias}.` : "";
  const apiOnly = options?.apiOnly ?? true;
  const includeProductFilter = options?.includeProductFilter ?? true;
  return `${prefix}event='paddle_transaction'
    ${apiOnly ? `AND toString(${prefix}properties.paddle_origin)='api'` : ""}
    AND toString(${prefix}properties.paddle_event_type)='transaction.completed'${includeProductFilter ? productRevenueClause(productOrToken, alias) : ""}`;
}

function paymentPopupCondition(product: ProductKey, alias?: string, mapping?: ToolMapping | null) {
  const prefix = alias ? `${alias}.` : "";
  if (product === "watermark" || product === "upscale") {
    // LIMIT_POPUP_TRIGGRED is already product-scoped by domain context
    if (mapping?.freeProperty) {
      return `${prefix}event='LIMIT_POPUP_TRIGGRED' AND ${exactLower(`toString(${prefix}properties.free_property)`, mapping.freeProperty)}`;
    }
    return `${prefix}event='LIMIT_POPUP_TRIGGRED'`;
  }

  // For pixelbin tools, scope PAYMENT_POP_UP by app_name to avoid cross-tool leaks
  if (mapping?.appName) {
    return `${prefix}event='PAYMENT_POP_UP' AND ${exactLower(`toString(${prefix}properties.app_name)`, mapping.appName)}`;
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
  const errorExpr = `lower(${errorMessageExpression()})`;
  const eventExpr = "lower(event)";
  const ignore = FAILURE_IGNORE_PATTERNS.map((pattern) =>
    `${errorExpr} NOT LIKE ${sqlLiteral(`%${pattern}%`)}`,
  );
  const technicalSignals = [
    `${errorExpr} LIKE '%network%'`,
    `${errorExpr} LIKE '%validation failed%'`,
    `${errorExpr} LIKE '%timeout%'`,
    `${errorExpr} LIKE '%timed out%'`,
    `${errorExpr} LIKE '%status code%'`,
    `${errorExpr} LIKE '%unexpected status%'`,
    `${errorExpr} LIKE '%503%'`,
    `${errorExpr} LIKE '%502%'`,
    `${errorExpr} LIKE '%500%'`,
    `${errorExpr} LIKE '%422%'`,
    `${errorExpr} LIKE '%fetch failed%'`,
    `${errorExpr} LIKE '%backend%'`,
    `${errorExpr} LIKE '%server%'`,
    `${errorExpr} LIKE '%connection%'`,
    `${errorExpr} LIKE '%upload failed%'`,
    `${errorExpr} LIKE '%no response%'`,
    `${eventExpr} IN ('generation_failed', 'video_generation_failed', 'image_transformation_failed', 'dynamic_app_transformation_failed', 'dynamic_app_transformation_polling_failed', 'dynamic_app_video_failed', 'dynamic_app_file_upload_failed', 'image_upload_failed', 'video_upload_failed')`,
  ];

  return `(
    (
      ${eventExpr} LIKE '%failed%'
      OR ${eventExpr} LIKE '%error%'
      OR ${errorExpr} LIKE '%fail%'
      OR ${errorExpr} LIKE '%error%'
    )
    AND (${technicalSignals.join(" OR ")})
  ) AND ${ignore.join(" AND ")}`;
}

function successEventCondition(product: ProductKey, alias?: string) {
  const prefix = alias ? `${alias}.` : "";

  if (product === "watermark") {
    return `(${prefix}event='IMAGE_TRANSFORMED' OR ${prefix}event='VIDEO_WATERMARK_REMOVED')`;
  }

  if (product === "upscale") {
    return `${prefix}event='IMAGE_TRANSFORMED'`;
  }

  return `(
    ${prefix}event IN ('GENERATION_COMPLETED', 'VIDEO_GENERATED', 'IMAGE_TRANSFORMED')
    OR ${prefix}event='DYNAMIC_APP_VIDEO_GENERATED'
    OR ${prefix}event='DYNAMIC_APP_TRANSFORMATION_POLLING_SUCCEEDED'
  )`;
}

function revenueCategoryExpression(alias?: string) {
  const prefix = alias ? `${alias}.` : "";
  const paddleName = `toString(${prefix}properties.paddle_name)`;

  return `CASE
    WHEN ${lowerLike(paddleName, "PB ")} OR ${lowerLike(paddleName, "Pixelbin")} THEN 'PB'
    WHEN ${lowerLike(paddleName, "UM ")} OR ${lowerLike(paddleName, "upscale")} THEN 'UM'
    WHEN ${lowerLike(paddleName, "WM ")} OR ${lowerLike(paddleName, "watermark")} OR ${lowerLike(paddleName, "WatermarkRemover")} THEN 'WM'
    WHEN ${lowerLike(paddleName, "EB ")} OR ${lowerLike(paddleName, "erase")} THEN 'EB'
    WHEN ${lowerLike(paddleName, "Custom")} THEN 'Custom'
    ELSE 'Other'
  END`;
}

function revenueExpression() {
  return "toFloatOrZero(toString(properties.paddle_unit_price)) / 100";
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
    aliases: ["watermarkremover", "mini-studio/watermarkremover"],
    firstEvent: "IMAGE_UPLOADED",
    seoUrlContains: "watermarkremover.io",
    consoleUrlContains: "mini-studio/watermarkremover",
    popupEvent: "LIMIT_POPUP_TRIGGRED",
    freeProperty: "watermarkremover",
  },
  {
    product: "watermark",
    key: "video-watermark-remover",
    aliases: ["video-watermark-remover", "mini-studio/video-watermark-remover"],
    firstEvent: "VIDEO_UPLOAD_ACTION",
    seoUrlContains: "video-watermark-remover",
    consoleUrlContains: "video-watermark-remover",
    popupEvent: "LIMIT_POPUP_TRIGGRED",
  },
  {
    product: "upscale",
    key: "upscalemedia",
    aliases: ["upscalemedia", "image-upscaler", "mini-studio/upscaler"],
    firstEvent: "IMAGE_TRANSFORMED",
    seoUrlContains: "upscale.media",
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

function mappingSeoEntryCondition(mapping: ToolMapping, alias?: string) {
  const prefix = aliasPrefix(alias);
  const conditions: string[] = [];

  if (mapping.seoUrlContains) {
    conditions.push(lowerLike(`toString(${prefix}properties.$current_url)`, mapping.seoUrlContains));
    conditions.push(lowerLike(`toString(${prefix}properties.$pathname)`, mapping.seoUrlContains));
  }

  if (mapping.freeProperty) {
    conditions.push(exactLower(`toString(${prefix}properties.free_property)`, mapping.freeProperty));
  }

  if (mapping.slug) {
    conditions.push(exactLower(`toString(${prefix}properties.slug)`, mapping.slug));
  }

  if (!conditions.length) {
    conditions.push(lowerLike(`toString(${prefix}properties.$current_url)`, mapping.key));
    conditions.push(lowerLike(`toString(${prefix}properties.$pathname)`, mapping.key));
  }

  return `(${conditions.join(" OR ")})`;
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
  return `(
    ${lowerLike(`toString(${prefix}properties.$current_url)`, normalized)}
    OR ${lowerLike(`toString(${prefix}properties.$pathname)`, normalized)}
    OR ${lowerLike(`toString(${prefix}properties.page)`, normalized)}
  )`;
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
  const epoch = "toDateTime('1970-01-01 00:00:00')";
  // Payment scoped to product + origin=api (new transactions only)
  const paymentClause = paymentCondition(args.product, undefined, {
    apiOnly: true,
    includeProductFilter: true,
  });
  const paymentUtm = paddleUtmClause(args.product, mapping);

  if (mapping && args.identifierValue) {
    const mappedStepTwoUrl = sanitizeFreeText(args.stepUrl || mapping.consoleUrlContains) || mapping.consoleUrlContains;
    const stepOneClause = `event='${mapping.firstEvent}' AND ${mappingSeoEntryCondition(mapping)}`;
    const stepTwoClause =
      mapping.popupEvent === "LIMIT_POPUP_TRIGGRED"
        ? mappedPopupCondition(mapping, undefined)
        : `event='$pageview' AND (
          ${lowerLike("toString(properties.$current_url)", mappedStepTwoUrl)}
          OR ${lowerLike("toString(properties.$pathname)", mappedStepTwoUrl)}
        )`;
    // Product-scoped payment: paddle_origin=api + paddle_utm matching tool
    const scopedPayment = `event='paddle_transaction'
      AND toString(properties.paddle_origin)='api'
      AND toString(properties.paddle_event_type)='transaction.completed'${paymentUtm}`;

    return `
WITH step1 AS (
  SELECT
    person_id AS actor_id,
    min(timestamp) AS step1_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND ${stepOneClause}
    ${testAccountFilter()}
  GROUP BY actor_id
),
actor_rollup AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${stepTwoClause}) AS step2_ts,
    minIf(timestamp, ${scopedPayment}) AS step3_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)}) + INTERVAL 14 DAY
    AND (${stepTwoClause} OR ${scopedPayment})
    ${testAccountFilter()}
  GROUP BY actor_id
)
SELECT
  ${sqlLiteral(mapping.key)} AS identifier_value,
  ${sqlLiteral(mapping.firstEvent)} AS first_event,
  uniqExact(s1.actor_id) AS step1_users,
  uniqExactIf(
    s1.actor_id,
    r.step2_ts > ${epoch}
    AND ${conversionWindow("r.step2_ts", "s1.step1_ts")}
  ) AS step2_users,
  uniqExactIf(
    s1.actor_id,
    r.step2_ts > ${epoch}
    AND r.step3_ts > ${epoch}
    AND ${conversionWindow("r.step2_ts", "s1.step1_ts")}
    AND r.step3_ts >= r.step2_ts
    AND ${conversionWindow("r.step3_ts", "s1.step1_ts")}
  ) AS step3_users
FROM step1 s1
LEFT JOIN actor_rollup r ON r.actor_id = s1.actor_id`;
  }

  const stepTwoClause =
    args.product === "watermark" || args.product === "upscale"
      ? paymentPopupCondition(args.product, undefined, mapping)
      : `event='$pageview' AND ${withStepUrl(args.stepUrl, config.stepTwoDefault, "")}`;
  // Generic SEO path: product-level payment scope (paddle_name matching PB/WM/UM),
  // not tool-level paddle_utm — many payments don't have specific tool UTMs.
  const scopedPayment = paymentCondition(args.product, undefined, {
    apiOnly: true,
    includeProductFilter: true,
  });

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
    ${testAccountFilter()}
  GROUP BY actor_id, identifier_value
),
actor_rollup AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${stepTwoClause}) AS step2_ts,
    minIf(timestamp, ${scopedPayment}) AS step3_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)}) + INTERVAL 14 DAY
    AND (${stepTwoClause} OR ${scopedPayment})
    ${testAccountFilter()}
  GROUP BY actor_id
)
SELECT
  s1.identifier_value AS identifier_value,
  any(s1.first_event) AS first_event,
  uniqExact(s1.actor_id) AS step1_users,
  uniqExactIf(
    s1.actor_id,
    r.step2_ts > ${epoch}
    AND ${conversionWindow("r.step2_ts", "s1.step1_ts")}
  ) AS step2_users,
  uniqExactIf(
    s1.actor_id,
    r.step2_ts > ${epoch}
    AND r.step3_ts > ${epoch}
    AND ${conversionWindow("r.step2_ts", "s1.step1_ts")}
    AND r.step3_ts >= r.step2_ts
    AND ${conversionWindow("r.step3_ts", "s1.step1_ts")}
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
  const mapping = resolveToolMapping(args.product, args.consoleUrl, args.consoleUrl);
  const mappedConsoleUrl = sanitizeFreeText(args.consoleUrl || mapping?.consoleUrlContains) || mapping?.consoleUrlContains || args.consoleUrl;
  const epoch = "toDateTime('1970-01-01 00:00:00')";
  const stepOneCondition = mapping
    ? `event='$pageview' AND (
        ${lowerLike("toString(properties.$current_url)", mappedConsoleUrl)}
        OR ${lowerLike("toString(properties.$pathname)", mappedConsoleUrl)}
      )`
    : `event='$pageview' AND ${lowerLike("toString(properties.$current_url)", args.consoleUrl)}`;
  // Product-scoped popup condition (filters by app_name / free_property)
  const popupCondition = mapping ? mappedPopupCondition(mapping) : paymentPopupCondition(args.product, undefined, mapping);
  // Console funnel payment: product-level scope (paddle_name matching PB/WM/UM),
  // NOT tool-level paddle_utm — matches PostHog F2 reference which has no tool attribution on payment.
  // The funnel ordering (studio visit → popup → payment) already provides the conversion linkage.
  const scopedPayment = paymentCondition(args.product, undefined, {
    apiOnly: true,
    includeProductFilter: true,
  });

  return `
WITH actor_rollup AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${stepOneCondition}) AS step1_ts,
    minIf(timestamp, ${popupCondition}) AS step2_ts,
    minIf(timestamp, ${scopedPayment}) AS step3_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)}) + INTERVAL 14 DAY
    AND (${stepOneCondition} OR ${popupCondition} OR ${scopedPayment})
    ${testAccountFilter()}
  GROUP BY actor_id
)
SELECT
  uniqExactIf(actor_id, step1_ts > ${epoch}) AS step1_users,
  uniqExactIf(
    actor_id,
    step1_ts > ${epoch}
    AND step2_ts > ${epoch}
    AND ${conversionWindow("step2_ts", "step1_ts")}
  ) AS step2_users,
  uniqExactIf(
    actor_id,
    step1_ts > ${epoch}
    AND step2_ts > ${epoch}
    AND step3_ts > ${epoch}
    AND ${conversionWindow("step2_ts", "step1_ts")}
    AND step3_ts >= step2_ts
    AND ${conversionWindow("step3_ts", "step1_ts")}
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
  const identifierExpr = args.identifierType ? identifierExpression(args.identifierType) : "''";
  const includeIdentifierDimension = Boolean(args.identifierType) && !sanitizeFreeText(args.identifierValue);
  const identifierSelect = includeIdentifierDimension
    ? `${identifierExpr} AS identifier_value,`
    : `${sqlLiteral(sanitizeFreeText(args.identifierValue) || "Scoped selection")} AS identifier_value,`;
  const identifierGroupBy = includeIdentifierDimension ? "identifier_value, " : "";
  const identifierConstraint = includeIdentifierDimension ? `AND ${nonEmptyExpression(identifierExpr)}` : "";

  return `
SELECT
  ${identifierSelect}
  ${errorMessageExpression()} AS raw_error,
  ${errorDetailExpression()} AS error_details,
  any(event) AS event_name,
  any(${modelExpression()}) AS model_id,
  any(coalesce(nullIf(toString(properties.operationID), ''), nullIf(toString(properties.operationId), ''), '')) AS operation_id,
  any(coalesce(nullIf(toString(properties.app_name), ''), nullIf(toString(properties.free_property), ''), nullIf(toString(properties.page), ''), nullIf(toString(properties.slug), ''), 'n/a')) AS scope_label,
  count() AS error_count,
  uniqExact(person_id) AS impacted_users
FROM events
WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
  AND timestamp < toDateTime(${sqlLiteral(args.to)})
  AND ${failureFilter()}
  ${scope}
  ${identifierFilter}
  ${identifierConstraint}
  ${testAccountFilter()}
GROUP BY ${identifierGroupBy}raw_error, error_details
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
  const popupCondition = paymentPopupCondition(args.product, undefined, null);

  return `
WITH scoped_users AS (
  SELECT uniqExact(person_id) AS total_users
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    ${scope}
    ${identifierFilter}
    ${testAccountFilter()}
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
    ${testAccountFilter()}
  GROUP BY actor_id
),
popup_users AS (
  SELECT
    person_id AS actor_id
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND ${popupCondition}
    ${testAccountFilter()}
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
  ${testAccountFilter()}
GROUP BY event_name
ORDER BY sample_count DESC
LIMIT 10`;
}

function buildPerformanceBreakdownQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType?: IdentifierType | null;
  identifierValue?: string | null;
}) {
  if (!args.identifierType || sanitizeFreeText(args.identifierValue)) {
    return "";
  }

  const scope = productScope(args.product);
  const identifierExpr = identifierExpression(args.identifierType);

  return `
SELECT
  ${identifierExpr} AS identifier_value,
  count() AS failures,
  uniqExact(person_id) AS impacted_users
FROM events
WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
  AND timestamp < toDateTime(${sqlLiteral(args.to)})
  AND ${failureFilter()}
  ${scope}
  AND ${nonEmptyExpression(identifierExpr)}
  ${testAccountFilter()}
GROUP BY identifier_value
ORDER BY impacted_users DESC, failures DESC
LIMIT 12`;
}

function buildPerformanceJourneyQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType?: IdentifierType | null;
  identifierValue?: string | null;
}) {
  const scope = productScope(args.product);
  const identifierFilter = withIdentifierFilter(args.identifierType, args.identifierValue);
  const popupCondition = paymentPopupCondition(args.product, undefined, null);

  return `
WITH actor_rollup AS (
  SELECT
    person_id AS actor_id,
    countIf(${failureFilter()}) AS failure_events,
    countIf(${successEventCondition(args.product)}) AS success_events,
    countIf(${popupCondition}) AS popup_events
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    ${scope}
    ${identifierFilter}
    ${testAccountFilter()}
  GROUP BY actor_id
)
SELECT
  uniqExactIf(actor_id, failure_events > 0 AND popup_events = 0) AS failure_before_paywall_users,
  uniqExactIf(actor_id, success_events > 0 AND popup_events = 0) AS success_without_paywall_users,
  uniqExactIf(actor_id, popup_events > 0) AS paywall_users
FROM actor_rollup`;
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
  uniqExact(person_id) AS buyers,
  sumIf(${revenueExpression()}, toString(properties.paddle_origin)='api') AS new_revenue,
  countIf(toString(properties.paddle_origin)='api') AS new_payments,
  uniqExactIf(person_id, toString(properties.paddle_origin)='api') AS new_buyers
FROM events
WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
  AND timestamp < toDateTime(${sqlLiteral(args.to)})
  AND event='paddle_transaction'
  AND toString(properties.paddle_event_type)='transaction.completed'${productRevenueClause(token)}`;
}

function buildRevenuePlansQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
}) {
  return `
SELECT
  ${revenueCategoryExpression()} AS plan_name,
  sum(${revenueExpression()}) AS revenue,
  count() AS payments,
  uniqExact(person_id) AS buyers
FROM events
WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
  AND timestamp < toDateTime(${sqlLiteral(args.to)})
  AND event='paddle_transaction'
  AND toString(properties.paddle_event_type)='transaction.completed'
GROUP BY plan_name
HAVING plan_name IN ('PB', 'WM', 'UM', 'EB', 'Custom')
ORDER BY multiIf(plan_name='PB', 1, plan_name='WM', 2, plan_name='UM', 3, plan_name='EB', 4, plan_name='Custom', 5, 99) ASC
LIMIT 5`;
}

function buildRevenueAttributionQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
}) {
  return `
WITH tx AS (
  SELECT
    lower(toString(properties.paddle_email)) AS buyer_email,
    sum(${revenueExpression()}) AS revenue,
    count() AS payments
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND event='paddle_transaction'
    AND toString(properties.paddle_event_type)='transaction.completed'
    ${productRevenueClause("PB")}
    AND ${nonEmptyExpression("toString(properties.paddle_email)")}
  GROUP BY buyer_email
),
usage_events AS (
  SELECT
    lower(toString(person.properties.email)) AS buyer_email,
    multiIf(
      ${exactLower("toString(e.properties.app_name)", "video-generator")} OR ${exactLower("toString(e.properties.app_name)", "ai-video-generator")} OR ${exactLower("toString(e.properties.page)", "ai-video-generator")}, 'Video Generator',
      ${exactLower("toString(e.properties.app_name)", "ai-image-generator")} OR ${exactLower("toString(e.properties.page)", "ai-image-generator")}, 'AI Image Generator',
      ${exactLower("toString(e.properties.app_name)", "ai-image-editor")} OR ${exactLower("toString(e.properties.page)", "ai-image-editor")}, 'AI Image Editor',
      ${exactLower("toString(e.properties.app_name)", "magic-canvas")}, 'Magic Canvas',
      ${exactLower("toString(e.properties.page)", "batch-editor")}, 'Batch Editor',
      ${exactLower("toString(e.properties.page)", "studio_ai-editor")}, 'AI Editor Studio',
      'Other'
    ) AS tool_bucket,
    count() AS usage_events
  FROM events e
  WHERE e.timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND e.timestamp < toDateTime(${sqlLiteral(args.to)})
    AND ${nonEmptyExpression("toString(person.properties.email)")}
    AND (
      toString(e.properties.app_name) IN ('video-generator', 'ai-video-generator', 'ai-image-generator', 'ai-image-editor', 'magic-canvas')
      OR toString(e.properties.page) IN ('ai-video-generator', 'ai-image-generator', 'ai-image-editor', 'studio_ai-editor', 'batch-editor')
    )
  GROUP BY buyer_email, tool_bucket
),
editor_usage AS (
  SELECT
    lower(toString(person.properties.email)) AS buyer_email,
    multiIf(
      ${lowerLike("toString(properties.tool_id)", "watermark")} OR ${lowerLike("toString(properties.tool_id)", "wm")}, 'AI Editor (Watermark)',
      ${lowerLike("toString(properties.tool_id)", "upscale")} OR ${lowerLike("toString(properties.tool_id)", "sr")} OR ${lowerLike("toString(properties.tool_id)", "super")}, 'AI Editor (Upscale)',
      ${lowerLike("toString(properties.tool_id)", "erase")} OR ${lowerLike("toString(properties.tool_id)", "bg")}, 'AI Editor (EraseBG)',
      'AI Editor (Image Edit/Gen)'
    ) AS tool_bucket,
    count() AS usage_events
  FROM events
  WHERE event = 'AI_EDITOR_TOOL_APPLY'
    AND timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND ${exactLower("toString(properties.page)", "studio_ai-editor")}
    AND ${nonEmptyExpression("toString(person.properties.email)")}
  GROUP BY buyer_email, tool_bucket
),
combined_usage AS (
  SELECT buyer_email, tool_bucket, usage_events FROM usage_events
  UNION ALL
  SELECT buyer_email, tool_bucket, usage_events FROM editor_usage
),
aggregated_usage AS (
  SELECT
    buyer_email,
    tool_bucket,
    sum(usage_events) AS usage_events,
    multiIf(
      tool_bucket = 'Video Generator', 700,
      tool_bucket = 'AI Image Generator', 600,
      tool_bucket = 'AI Image Editor', 500,
      tool_bucket = 'Magic Canvas', 400,
      tool_bucket = 'AI Editor (Watermark)', 320,
      tool_bucket = 'AI Editor (Upscale)', 310,
      tool_bucket = 'AI Editor (EraseBG)', 300,
      tool_bucket = 'AI Editor (Image Edit/Gen)', 290,
      tool_bucket = 'Batch Editor', 100,
      tool_bucket = 'AI Editor Studio', 50,
      0
    ) AS priority_score
  FROM combined_usage
  GROUP BY buyer_email, tool_bucket
),
primary_usage AS (
  SELECT
    buyer_email,
    argMax(tool_bucket, usage_events * 1000 + priority_score) AS primary_tool
  FROM aggregated_usage
  GROUP BY buyer_email
)
SELECT
  coalesce(nullIf(primary_tool, ''), 'No Tool Usage') AS primary_tool,
  sum(tx.revenue) AS revenue,
  sum(tx.payments) AS payments,
  count() AS buyers
FROM tx
LEFT JOIN primary_usage pu ON pu.buyer_email = tx.buyer_email
GROUP BY primary_tool
ORDER BY revenue DESC
LIMIT 12`;
}

function buildNoDiscoveryQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType: IdentifierType;
  identifierValue: string;
  mainTool?: string | null;
  stepUrl?: string | null;
}) {
  const config = PRODUCT_CONFIGS[args.product];
  const identifierFilter = withIdentifierFilter(args.identifierType, args.identifierValue);
  const mapping = resolveToolMapping(args.product, args.identifierValue, args.stepUrl ?? args.mainTool);
  const epoch = "toDateTime('1970-01-01 00:00:00')";
  const stepTwoCondition =
    args.product === "watermark" || args.product === "upscale"
      ? paymentPopupCondition(args.product, undefined, mapping)
      : `event='$pageview' AND ${withStepUrl(args.stepUrl, config.stepTwoDefault, "")}`;

  if (mapping) {
    const mappedStepTwoCondition =
      mapping.popupEvent === "LIMIT_POPUP_TRIGGRED"
        ? mappedPopupCondition(mapping)
        : `event='$pageview' AND (
            ${lowerLike("toString(properties.$current_url)", sanitizeFreeText(args.stepUrl || mapping.consoleUrlContains) || mapping.consoleUrlContains)}
            OR ${lowerLike("toString(properties.$pathname)", sanitizeFreeText(args.stepUrl || mapping.consoleUrlContains) || mapping.consoleUrlContains)}
          )`;

    return `
WITH step1 AS (
  SELECT
    person_id AS actor_id,
    min(timestamp) AS step1_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND event='${mapping.firstEvent}'
    AND ${mappingSeoEntryCondition(mapping)}
    ${testAccountFilter()}
  GROUP BY actor_id
),
step2 AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${mappedStepTwoCondition}) AS step2_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)}) + INTERVAL 14 DAY
    AND (${mappedStepTwoCondition})
    ${testAccountFilter()}
  GROUP BY actor_id
),
post_step2 AS (
  SELECT
    e.person_id AS actor_id,
    countIf(
      e.event NOT IN ('$pageview', '$autocapture', '$identify', '$set')
      AND e.timestamp > s2.step2_ts
    ) AS post_events
  FROM events e
  INNER JOIN step2 s2 ON s2.actor_id = e.person_id
  WHERE e.timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND e.timestamp < toDateTime(${sqlLiteral(args.to)}) + INTERVAL 14 DAY
    AND s2.step2_ts > ${epoch}
  GROUP BY actor_id
)
SELECT
  uniqExactIf(
    s.actor_id,
    s2.step2_ts > ${epoch}
    AND ${conversionWindow("s2.step2_ts", "s.step1_ts")}
  ) AS reached_step2,
  uniqExactIf(
    s.actor_id,
    s2.step2_ts > ${epoch}
    AND ${conversionWindow("s2.step2_ts", "s.step1_ts")}
    AND coalesce(p.post_events, 0) = 0
  ) AS no_discovery_users
FROM step1 s
LEFT JOIN step2 s2 ON s2.actor_id = s.actor_id
LEFT JOIN post_step2 p ON p.actor_id = s.actor_id`;
  }

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
    ${testAccountFilter()}
  GROUP BY actor_id
),
step2 AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${stepTwoCondition}) AS step2_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)}) + INTERVAL 14 DAY
    AND (${stepTwoCondition})
    ${testAccountFilter()}
  GROUP BY actor_id
),
post_step2 AS (
  SELECT
    e.person_id AS actor_id,
    count() AS post_events
  FROM events e
  INNER JOIN step2 s2 ON s2.actor_id = e.person_id
  WHERE e.timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND e.timestamp < toDateTime(${sqlLiteral(args.to)}) + INTERVAL 14 DAY
    AND s2.step2_ts > ${epoch}
    AND e.timestamp > s2.step2_ts
  GROUP BY actor_id
)
SELECT
  uniqExactIf(
    s.actor_id,
    s2.step2_ts > ${epoch}
    AND ${conversionWindow("s2.step2_ts", "s.step1_ts")}
  ) AS reached_step2,
  uniqExactIf(
    s.actor_id,
    s2.step2_ts > ${epoch}
    AND ${conversionWindow("s2.step2_ts", "s.step1_ts")}
    AND coalesce(p.post_events, 0) = 0
  ) AS no_discovery_users
FROM step1 s
LEFT JOIN step2 s2 ON s2.actor_id = s.actor_id
LEFT JOIN post_step2 p ON p.actor_id = s.actor_id`;
}

function buildFunnelStageInsightsQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType: IdentifierType;
  identifierValue: string;
  mainTool?: string | null;
  stepUrl?: string | null;
}) {
  const config = PRODUCT_CONFIGS[args.product];
  const mapping = resolveToolMapping(args.product, args.identifierValue, args.stepUrl ?? args.mainTool);
  const identifierFilter = withIdentifierFilter(args.identifierType, args.identifierValue);
  // Product-level payment scope (not tool-level paddle_utm)
  const scopedPayment = paymentCondition(args.product, undefined, {
    apiOnly: true,
    includeProductFilter: true,
  });
  const epoch = "toDateTime('1970-01-01 00:00:00')";

  const stepTwoClause =
    args.product === "watermark" || args.product === "upscale"
      ? mapping
        ? mappedPopupCondition(mapping)
        : paymentPopupCondition(args.product, undefined, mapping)
      : mapping
        ? `event='$pageview' AND (
            ${lowerLike("toString(properties.$current_url)", sanitizeFreeText(args.stepUrl || mapping.consoleUrlContains) || mapping.consoleUrlContains)}
            OR ${lowerLike("toString(properties.$pathname)", sanitizeFreeText(args.stepUrl || mapping.consoleUrlContains) || mapping.consoleUrlContains)}
          )`
        : `event='$pageview' AND ${withStepUrl(args.stepUrl, config.stepTwoDefault, "")}`;

  const popupClause = mapping ? mappedPopupCondition(mapping) : paymentPopupCondition(args.product, undefined, mapping);
  const failureClauseEvent = mapping ? `(${failureFilter()}) AND ${mappingScopeCondition(mapping, "e")}` : failureFilter();
  const successClauseEvent = mapping
    ? `(${successEventCondition(args.product, "e")}) AND ${mappingScopeCondition(mapping, "e")}`
    : successEventCondition(args.product, "e");

  const step1Cte = mapping
    ? `
step1 AS (
  SELECT
    person_id AS actor_id,
    min(timestamp) AS step1_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND event='${mapping.firstEvent}'
    AND ${mappingSeoEntryCondition(mapping)}
    ${testAccountFilter()}
  GROUP BY actor_id
)`
    : `
step1 AS (
  SELECT
    person_id AS actor_id,
    min(timestamp) AS step1_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    ${identifierFilter}
    ${productScope(args.product)}
    ${mainToolFilter(args.mainTool)}
    ${testAccountFilter()}
  GROUP BY actor_id
)`;

  return `
WITH ${step1Cte},
actor_rollup AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${stepTwoClause}) AS step2_ts,
    minIf(timestamp, ${popupClause}) AS popup_ts,
    minIf(timestamp, event='CHECKOUT_INITIATED') AS checkout_ts,
    minIf(timestamp, ${scopedPayment}) AS step3_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)}) + INTERVAL 14 DAY
    AND (${stepTwoClause} OR ${popupClause} OR event='CHECKOUT_INITIATED' OR ${scopedPayment})
    ${testAccountFilter()}
  GROUP BY actor_id
),
actor_metrics AS (
  SELECT
    s1.actor_id AS actor_id,
    s1.step1_ts AS step1_ts,
    r.step2_ts AS step2_ts,
    r.popup_ts AS popup_ts,
    r.checkout_ts AS checkout_ts,
    r.step3_ts AS step3_ts,
    countIf(
      e.timestamp >= s1.step1_ts
      AND e.timestamp < if(r.step2_ts > ${epoch}, r.step2_ts, s1.step1_ts + INTERVAL 14 DAY)
      AND ${failureClauseEvent}
    ) AS pre_step2_failures,
    countIf(
      r.step2_ts > ${epoch}
      AND e.timestamp >= r.step2_ts
      AND e.timestamp <= s1.step1_ts + INTERVAL 14 DAY
      AND ${failureClauseEvent}
    ) AS post_step2_failures,
    countIf(
      r.step2_ts > ${epoch}
      AND e.timestamp >= r.step2_ts
      AND e.timestamp <= s1.step1_ts + INTERVAL 14 DAY
      AND ${successClauseEvent}
    ) AS post_step2_successes
  FROM step1 s1
  LEFT JOIN actor_rollup r ON r.actor_id = s1.actor_id
  LEFT JOIN events e ON e.person_id = s1.actor_id
    AND e.timestamp >= s1.step1_ts
    AND e.timestamp <= s1.step1_ts + INTERVAL 14 DAY
  GROUP BY s1.actor_id, s1.step1_ts, r.step2_ts, r.popup_ts, r.checkout_ts, r.step3_ts
)
SELECT
  uniqExact(actor_id) AS step1_users,
  uniqExactIf(actor_id, pre_step2_failures > 0) AS step1_failure_users,
  uniqExactIf(actor_id, popup_ts > ${epoch} AND ${conversionWindow("popup_ts", "step1_ts")}) AS step1_popup_users,
  uniqExactIf(actor_id, checkout_ts > ${epoch} AND ${conversionWindow("checkout_ts", "step1_ts")}) AS step1_checkout_users,
  uniqExactIf(actor_id, step2_ts > ${epoch} AND ${conversionWindow("step2_ts", "step1_ts")}) AS step2_users,
  uniqExactIf(actor_id, step2_ts > ${epoch} AND ${conversionWindow("step2_ts", "step1_ts")} AND popup_ts > ${epoch} AND popup_ts >= step2_ts) AS step2_popup_users,
  uniqExactIf(actor_id, step2_ts > ${epoch} AND ${conversionWindow("step2_ts", "step1_ts")} AND post_step2_failures > 0) AS step2_failure_users,
  uniqExactIf(actor_id, step2_ts > ${epoch} AND ${conversionWindow("step2_ts", "step1_ts")} AND post_step2_successes > 0) AS step2_success_users,
  uniqExactIf(actor_id, step2_ts > ${epoch} AND ${conversionWindow("step2_ts", "step1_ts")} AND checkout_ts > ${epoch} AND checkout_ts >= step2_ts) AS step2_checkout_users,
  uniqExactIf(actor_id, step2_ts > ${epoch} AND ${conversionWindow("step2_ts", "step1_ts")} AND step3_ts > ${epoch} AND step3_ts >= step2_ts AND ${conversionWindow("step3_ts", "step1_ts")}) AS step2_paid_users,
  uniqExactIf(actor_id, step3_ts > ${epoch} AND ${conversionWindow("step3_ts", "step1_ts")}) AS step3_users
FROM actor_metrics`;
}

function buildFunnelStageEventMixQuery(args: {
  product: ProductKey;
  from: string;
  to: string;
  identifierType: IdentifierType;
  identifierValue: string;
  mainTool?: string | null;
  stepUrl?: string | null;
}) {
  const config = PRODUCT_CONFIGS[args.product];
  const mapping = resolveToolMapping(args.product, args.identifierValue, args.stepUrl ?? args.mainTool);
  const identifierFilter = withIdentifierFilter(args.identifierType, args.identifierValue);
  // Product-level payment scope (not tool-level paddle_utm)
  const scopedPayment = paymentCondition(args.product, undefined, {
    apiOnly: true,
    includeProductFilter: true,
  });
  const epoch = "toDateTime('1970-01-01 00:00:00')";

  const stepTwoClause =
    args.product === "watermark" || args.product === "upscale"
      ? mapping
        ? mappedPopupCondition(mapping)
        : paymentPopupCondition(args.product, undefined, mapping)
      : mapping
        ? `event='$pageview' AND (
            ${lowerLike("toString(properties.$current_url)", sanitizeFreeText(args.stepUrl || mapping.consoleUrlContains) || mapping.consoleUrlContains)}
            OR ${lowerLike("toString(properties.$pathname)", sanitizeFreeText(args.stepUrl || mapping.consoleUrlContains) || mapping.consoleUrlContains)}
          )`
        : `event='$pageview' AND ${withStepUrl(args.stepUrl, config.stepTwoDefault, "")}`;

  const popupClause = mapping ? mappedPopupCondition(mapping) : paymentPopupCondition(args.product, undefined, mapping);
  const excludedEvents = [
    "$pageview",
    "$autocapture",
    "$identify",
    "$set",
    "$rageclick",
    "GOOGLE_ONE_TAP_SHOWN",
    "GOOGLE_ONE_TAP_SKIPPED",
    "GOOGLE_ONE_TAP_NOT_DISPLAYED",
    "GOOGLE_ONE_TAP_DISMISSED",
  ]
    .map((eventName) => sqlLiteral(eventName))
    .join(", ");
  const focusedEvents = [
    mapping?.firstEvent,
    "CHECKOUT_INITIATED",
    "USER_SIGN_UP_SUCCESS",
    "PAYMENT_POP_UP",
    "LIMIT_POPUP_TRIGGRED",
    "PRICING_POPUP",
    "UPGRADE_BUTTON_CLICK",
    "PAYMENT_POP_UP_DISMISSED",
    "CREDITS_LIMIT_POPUP_OPENED",
  ]
    .filter(Boolean)
    .map((eventName) => sqlLiteral(eventName as string))
    .join(", ");

  const step1Cte = mapping
    ? `
step1 AS (
  SELECT
    person_id AS actor_id,
    min(timestamp) AS step1_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    AND event='${mapping.firstEvent}'
    AND ${mappingSeoEntryCondition(mapping)}
    ${testAccountFilter()}
  GROUP BY actor_id
)`
    : `
step1 AS (
  SELECT
    person_id AS actor_id,
    min(timestamp) AS step1_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)})
    ${identifierFilter}
    ${productScope(args.product)}
    ${mainToolFilter(args.mainTool)}
    ${testAccountFilter()}
  GROUP BY actor_id
)`;

  return `
WITH ${step1Cte},
actor_rollup AS (
  SELECT
    person_id AS actor_id,
    minIf(timestamp, ${stepTwoClause}) AS step2_ts,
    minIf(timestamp, ${popupClause}) AS popup_ts,
    minIf(timestamp, event='CHECKOUT_INITIATED') AS checkout_ts,
    minIf(timestamp, ${scopedPayment}) AS step3_ts
  FROM events
  WHERE timestamp >= toDateTime(${sqlLiteral(args.from)})
    AND timestamp < toDateTime(${sqlLiteral(args.to)}) + INTERVAL 14 DAY
    AND (${stepTwoClause} OR ${popupClause} OR event='CHECKOUT_INITIATED' OR ${scopedPayment})
    ${testAccountFilter()}
  GROUP BY actor_id
),
base AS (
  SELECT
    multiIf(
      r.step2_ts > ${epoch}
      AND (r.checkout_ts > ${epoch} OR r.popup_ts > ${epoch})
      AND e.timestamp >= if(r.checkout_ts > ${epoch}, r.checkout_ts, if(r.popup_ts > ${epoch}, r.popup_ts, r.step2_ts)),
      'Step 3 - checkout',
      r.step2_ts > ${epoch}
      AND e.timestamp >= r.step2_ts,
      'Step 2 - main tool',
      'Step 1 - pre-landing'
    ) AS stage,
    e.event AS event_name,
    count() AS event_count,
    uniqExact(e.person_id) AS users
  FROM events e
  INNER JOIN step1 s1 ON s1.actor_id = e.person_id
  LEFT JOIN actor_rollup r ON r.actor_id = e.person_id
  WHERE e.timestamp >= s1.step1_ts
    AND e.timestamp <= s1.step1_ts + INTERVAL 14 DAY
    AND e.event NOT IN (${excludedEvents})
    AND (
      e.event IN (${focusedEvents})
      OR ${failureFilter()}
      OR ${successEventCondition(args.product, "e")}
    )
  GROUP BY stage, event_name
),
ranked AS (
  SELECT
    stage,
    event_name,
    event_count,
    users,
    row_number() OVER (PARTITION BY stage ORDER BY users DESC, event_count DESC) AS row_num
  FROM base
)
SELECT
  stage,
  event_name,
  event_count,
  users
FROM ranked
WHERE row_num <= 5
ORDER BY stage ASC, row_num ASC`;
}

async function buildSeoFunnelsPayload(request: DashboardRequest): Promise<DashboardPayload> {
  const bundle = resolveComparisonBundle(request);
  const config = PRODUCT_CONFIGS[request.product];
  const identifierType = request.identifierType ?? config.funnelIdentifierTypes[0];
  const selectedIdentifier = sanitizeFreeText(request.identifierValue);
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

  addQuery(queries, "seo-current", "Current SEO funnel query", "Person-linked funnel from first identifier touch to the main-tool landing step and then paddle conversion.", currentSql);
  addQuery(queries, "seo-comparison", "Comparison SEO funnel query", "Same main-tool funnel logic for the comparison period.", compareSql);
  const noDiscoverySql = selectedIdentifier
    ? buildNoDiscoveryQuery({
        product: request.product,
        from: bundle.current.from,
        to: bundle.current.to,
        identifierType,
        identifierValue: selectedIdentifier,
        mainTool: request.mainTool,
        stepUrl: request.stepUrl,
      })
    : "";
  if (noDiscoverySql) {
    addQuery(queries, "seo-no-discovery", "No product discovery query", "Users who reached step 2 but generated no follow-on activity.", noDiscoverySql);
  }

  const [currentRows, comparisonRows, noDiscoveryRows] = await Promise.all([
    runHogQL<NumericRow>(currentSql),
    runHogQL<NumericRow>(compareSql),
    noDiscoverySql ? runHogQL<NumericRow>(noDiscoverySql) : Promise.resolve([]),
  ]);
  const noDiscovery = noDiscoveryRows[0] ?? {};

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
  const reachedStep2 = toNumber(noDiscovery.reached_step2);
  const noDiscoveryUsers = toNumber(noDiscovery.no_discovery_users);
  const discoveryTone: "negative" | "neutral" = noDiscoveryUsers > 0 ? "negative" : "neutral";

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
    ...(selectedIdentifier
      ? [
          {
            id: "seo-no-discovery",
            label: "No product discovery",
            value: compactNumber(noDiscoveryUsers),
            hint: reachedStep2 ? `${percent((noDiscoveryUsers / reachedStep2) * 100)} of step 2 users` : "No step 2 users",
            queryKey: "seo-no-discovery",
          },
        ]
      : []),
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
    ...(selectedIdentifier
      ? [
          {
            id: "seo-discovery-gap",
            eyebrow: "Discovery gap",
            title: "Watch users who land on step 2 but do nothing next",
            body: reachedStep2
              ? `${percent((noDiscoveryUsers / reachedStep2) * 100)} of step-2 users had no follow-on activity. That usually points to weak onboarding, unclear next steps, or a missing prompt to continue after the landing page.`
              : "No step-2 users were detected for this identifier in the current range.",
            tone: discoveryTone,
            queryKey: "seo-no-discovery",
          },
        ]
      : []),
  ];

  return {
    title: `${config.label} SEO funnels`,
    subtitle: `First identifier touch -> ${config.stepTwoDefault === "studio" ? "main-tool landing" : "limit popup"} -> paddle transaction.`,
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
    summaryText: summaryText(`${config.label} SEO funnels`, cards, callouts, [
      { title: "SEO funnel rows", rows: displayRows },
      ...(selectedIdentifier ? [{ title: "No discovery check", rows: [{ reachedStep2, noDiscoveryUsers }] }] : []),
    ]),
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
  const breakdownSql = buildPerformanceBreakdownQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    identifierType: request.identifierType,
    identifierValue: request.identifierValue,
  });
  const journeySql = buildPerformanceJourneyQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    identifierType: request.identifierType,
    identifierValue: request.identifierValue,
  });

  addQuery(queries, "perf-errors", "Failure breakdown query", "Top technical error messages after filtering out content-policy and credit noise.", errorsSql);
  addQuery(queries, "perf-rollup", "Performance rollup query", "Impacted users and paywall drop after first actionable failure.", rollupSql);
  addQuery(queries, "perf-rollup-compare", "Comparison performance rollup query", "Same performance rollup for the previous comparison period.", rollupCompareSql);
  addQuery(queries, "perf-context", "Failure context query", "Pulls sample model, prompt, and input payload context to help debugging.", contextSql);
  if (breakdownSql) {
    addQuery(queries, "perf-breakdown", "Identifier breakdown query", "Breaks technical failures down by the selected identifier dimension.", breakdownSql);
  }
  addQuery(queries, "perf-journey", "Journey risk query", "Measures level-1 failures, successful outputs without paywall, and paywall exposure across the selected scope.", journeySql);

  const [errorRows, rollupRows, comparisonRows, contextRows, breakdownRows, journeyRows] = await Promise.all([
    runHogQL<NumericRow>(errorsSql),
    runHogQL<NumericRow>(rollupSql),
    runHogQL<NumericRow>(rollupCompareSql),
    runHogQL<NumericRow>(contextSql),
    breakdownSql ? runHogQL<NumericRow>(breakdownSql) : Promise.resolve([]),
    runHogQL<NumericRow>(journeySql),
  ]);
  const rollup = rollupRows[0] ?? {};
  const compare = comparisonRows[0] ?? {};
  const journey = journeyRows[0] ?? {};

  const totalUsers = toNumber(rollup.total_users);
  const impactedUsers = toNumber(rollup.impacted_users);
  const droppedBeforePaywall = toNumber(rollup.dropped_before_paywall);
  const compareImpacted = toNumber(compare.impacted_users);
  const failureBeforePaywallUsers = toNumber(journey.failure_before_paywall_users);
  const successWithoutPaywallUsers = toNumber(journey.success_without_paywall_users);
  const paywallUsers = toNumber(journey.paywall_users);

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
      hint: "Technical issues only. Content-policy noise excluded.",
      queryKey: "perf-errors",
    },
    {
      id: "perf-drop",
      label: "Users dropping before paywall",
      value: compactNumber(droppedBeforePaywall),
      hint: impactedUsers ? `${percent((droppedBeforePaywall / impactedUsers) * 100)} of impacted users` : "No impacted users",
      queryKey: "perf-rollup",
    },
    {
      id: "perf-success-no-paywall",
      label: "Successful output, no paywall",
      value: compactNumber(successWithoutPaywallUsers),
      hint: totalUsers ? `${percent((successWithoutPaywallUsers / totalUsers) * 100)} of scoped users` : "No scoped users",
      queryKey: "perf-journey",
    },
  ];

  const primaryBreakdown = breakdownRows[0];
  const identifierLabel = request.identifierType ? IDENTIFIER_LABELS[request.identifierType] : "Identifier";
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
    {
      id: "perf-journey",
      eyebrow: "Journey leak",
      title: "Separate product quality issues from pricing exposure issues",
      body:
        successWithoutPaywallUsers > failureBeforePaywallUsers
          ? `More users are completing a core action without ever seeing the paywall than failing technically before it. That usually means output quality, post-success prompts, or monetization timing should be reviewed alongside error fixes.`
          : `Technical failures before the paywall are the larger leak right now. Prioritize the top error buckets first, then inspect whether the paywall timing still makes sense after those fixes land.`,
      tone: "neutral",
      queryKey: "perf-journey",
    },
    ...(primaryBreakdown
      ? [
          {
            id: "perf-scope-hotspot",
            eyebrow: `${identifierLabel} hotspot`,
            title: `${toStringValue(primaryBreakdown.identifier_value) || "Top scoped segment"} needs the first pass`,
            body: `${compactNumber(toNumber(primaryBreakdown.impacted_users))} impacted users and ${compactNumber(toNumber(primaryBreakdown.failures))} technical failures make this the highest-priority ${identifierLabel.toLowerCase()} slice in the current range.`,
            tone: "neutral" as const,
            queryKey: breakdownSql ? "perf-breakdown" : "perf-errors",
          },
        ]
      : []),
  ];

  const errorTableRows = topContributors.map((row) => ({
    identifier: toStringValue(row.identifier_value) || "Scoped selection",
    event: toStringValue(row.event_name),
    operationId:
      request.identifierType === "operationID" && !sanitizeFreeText(request.identifierValue)
        ? toStringValue(row.scope_label) || "n/a"
        : toStringValue(row.operation_id) || toStringValue(row.scope_label) || "n/a",
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
  const breakdownTableRows = breakdownRows.map((row) => ({
    identifier: toStringValue(row.identifier_value),
    impactedUsers: toNumber(row.impacted_users),
    failures: toNumber(row.failures),
  }));
  const journeyTableRows = [
    {
      metric: "Level 1 technical failures before paywall",
      users: failureBeforePaywallUsers,
      share: impactedUsers ? percent((failureBeforePaywallUsers / impactedUsers) * 100) : "0%",
      note: "Users who hit a technical failure and never reached a paywall event.",
    },
    {
      metric: "Successful output without paywall",
      users: successWithoutPaywallUsers,
      share: totalUsers ? percent((successWithoutPaywallUsers / totalUsers) * 100) : "0%",
      note: "Users who saw a successful outcome but never saw a paywall event.",
    },
    {
      metric: "Users exposed to paywall",
      users: paywallUsers,
      share: totalUsers ? percent((paywallUsers / totalUsers) * 100) : "0%",
      note: "Users who encountered the paywall event in the current period.",
    },
  ];
  const showIdentifierColumn = Boolean(request.identifierType) && !sanitizeFreeText(request.identifierValue);
  const errorColumns = [
    ...(showIdentifierColumn ? [{ key: "identifier", label: identifierLabel }] : []),
    { key: "event", label: "Event" },
    { key: "operationId", label: request.identifierType === "operationID" ? "Operation / tool" : "Tool context" },
    { key: "error", label: "Error" },
    { key: "details", label: "Error details" },
    { key: "modelId", label: "Model" },
    { key: "failures", label: "Failures", align: "right" as const },
    { key: "impactedUsers", label: "Impacted users", align: "right" as const },
    { key: "share", label: "Error share", align: "right" as const },
  ];

  return {
    title: `${config.label} product performance`,
    subtitle: request.identifierValue
      ? `Investigating ${request.identifierType ? IDENTIFIER_LABELS[request.identifierType] : "identifier"} = ${request.identifierValue}.`
      : "Actionable failure trends for the selected product scope.",
    cards,
    tables: [
      {
        id: "perf-error-table",
        title: request.identifierType === "operationID" && !request.identifierValue
          ? "Top actionable technical errors by Operation ID"
          : "Top actionable technical errors",
        description: "Rows shown until they cover roughly 80% of filtered failures.",
        queryKey: "perf-errors",
        columns: errorColumns,
        rows: errorTableRows,
        emptyState: "No actionable failure messages matched the current scope.",
      },
      ...(breakdownTableRows.length
        ? [
            {
              id: "perf-breakdown-table",
              title: `${identifierLabel} breakdown`,
              description: "Highest-impact slices ranked by unique users hit by technical failures.",
              queryKey: breakdownSql ? "perf-breakdown" : "perf-errors",
              columns: [
                { key: "identifier", label: identifierLabel },
                { key: "impactedUsers", label: "Impacted users", align: "right" as const },
                { key: "failures", label: "Failures", align: "right" as const },
              ],
              rows: breakdownTableRows,
            },
          ]
        : []),
      {
        id: "perf-journey-table",
        title: "Product performance level checks",
        description: "Counts the biggest user-journey leaks the team can act on immediately.",
        queryKey: "perf-journey",
        columns: [
          { key: "metric", label: "Metric" },
          { key: "users", label: "Users", align: "right" as const },
          { key: "share", label: "Share", align: "right" as const },
          { key: "note", label: "Why it matters" },
        ],
        rows: journeyTableRows,
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
      { title: "Journey checks", rows: journeyTableRows },
      { title: `${identifierLabel} breakdown`, rows: breakdownTableRows },
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

  addQuery(queries, "rev-summary", "Revenue summary query", "Total revenue from all completed paddle transactions plus API-origin new revenue.", summarySql);
  addQuery(queries, "rev-summary-compare", "Comparison revenue summary query", "Same total-vs-new revenue rollup for the comparison period.", compareSql);
  addQuery(queries, "rev-plans", "Revenue by product category query", "PB, WM, UM, EB, and Custom category mix based on paddle names.", plansSql);
  addQuery(queries, "rev-attribution", "Revenue by tool query", "Attributes buyer revenue to their dominant tool usage within the period.", attributionSql);

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
  const newRevenue = toNumber(summary.new_revenue);
  const newPayments = toNumber(summary.new_payments);
  const newBuyers = toNumber(summary.new_buyers);
  const compareRevenue = toNumber(comparison.total_revenue);
  const comparePayments = toNumber(comparison.total_payments);
  const compareNewRevenue = toNumber(comparison.new_revenue);

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
      id: "rev-new",
      label: "New revenue",
      value: currency(newRevenue),
      delta: deltaLabel(newRevenue, compareNewRevenue),
      deltaTone: deltaTone(newRevenue, compareNewRevenue),
      hint: "API-origin completed transactions",
      queryKey: "rev-summary",
    },
    {
      id: "rev-payments",
      label: "Payments",
      value: compactNumber(totalPayments),
      delta: deltaLabel(totalPayments, comparePayments),
      deltaTone: deltaTone(totalPayments, comparePayments),
      hint: buyers ? `${buyers} buyers total` : "No buyers",
      queryKey: "rev-summary",
    },
    {
      id: "rev-aov",
      label: "Revenue per payment",
      value: currency(totalPayments === 0 ? 0 : totalRevenue / totalPayments),
      hint: newPayments ? `${compactNumber(newPayments)} API payments · ${newBuyers} API buyers` : "No API-origin purchases",
      queryKey: "rev-summary",
    },
  ];

  const planMap = new Map(planRows.map((row) => [toStringValue(row.plan_name), row]));
  const planRowsMapped = ["PB", "WM", "UM", "EB", "Custom"].map((category) => {
    const row = planMap.get(category);
    return {
      plan: category,
      revenue: currency(toNumber(row?.revenue)),
      payments: toNumber(row?.payments),
      buyers: toNumber(row?.buyers),
    };
  });
  const attributionMapped = attributionRows.map((row) => ({
    tool: toStringValue(row.primary_tool),
    revenueValue: toNumber(row.revenue),
    revenue: currency(toNumber(row.revenue)),
    payments: toNumber(row.payments),
    buyers: toNumber(row.buyers),
    contribution: totalRevenue === 0 ? "0%" : percent((toNumber(row.revenue) / totalRevenue) * 100),
  }));
  const attributionTotal = attributionMapped.reduce((sum, row) => sum + row.revenueValue, 0);
  const attributionDisplayRows = [
    ...attributionMapped.map((row) => {
      const { revenueValue, ...displayRow } = row;
      void revenueValue;
      return displayRow;
    }),
    {
      tool: "TOTAL",
      revenue: currency(attributionTotal),
      payments: "",
      buyers: "",
      contribution: "100%",
    },
  ];

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
      ? `Summary cards are filtered to ${config.revenueToken} plan revenue. Category and tool tables benchmark the broader revenue mix.`
      : "Cross-product revenue view using completed paddle transactions, with API-origin revenue tracked separately as new revenue.",
    cards,
    tables: [
      {
        id: "rev-plan-table",
        title: "Revenue by product category",
        queryKey: "rev-plans",
        columns: [
          { key: "plan", label: "Category" },
          { key: "revenue", label: "Revenue", align: "right" },
          { key: "payments", label: "Payments", align: "right" },
          { key: "buyers", label: "Buyers", align: "right" },
        ],
        rows: planRowsMapped,
      },
      {
        id: "rev-attribution-table",
        title: "Revenue by tool",
        description: "Buyer revenue attributed to the dominant tool used in-period. % Rev uses PB revenue only as the denominator.",
        queryKey: "rev-attribution",
        columns: [
          { key: "tool", label: "Tool" },
          { key: "revenue", label: "Est Revenue", align: "right" },
          { key: "contribution", label: "% Rev", align: "right" },
        ],
        rows: attributionDisplayRows,
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
    mainTool: request.mainTool,
    stepUrl: request.stepUrl,
  });
  const stageInsightsSql = buildFunnelStageInsightsQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    identifierType,
    identifierValue,
    mainTool: request.mainTool,
    stepUrl: request.stepUrl,
  });
  const stageEventsSql = buildFunnelStageEventMixQuery({
    product: request.product,
    from: bundle.current.from,
    to: bundle.current.to,
    identifierType,
    identifierValue,
    mainTool: request.mainTool,
    stepUrl: request.stepUrl,
  });
  addQuery(queries, "detail-no-discovery", "No discovery query", "Users who hit step 2 but produced no follow-on activity.", noDiscoverySql);
  addQuery(queries, "detail-stage-insights", "Step-level funnel insights query", "Stage-level failure, paywall, checkout, and payment diagnostics for the selected funnel.", stageInsightsSql);
  addQuery(queries, "detail-stage-events", "Top stage events query", "Top non-noise events seen across step 1, step 2, and checkout cohorts.", stageEventsSql);

  const [noDiscoveryResult, stageInsightResult, stageEventResult] = await Promise.allSettled([
    runHogQL<NumericRow>(noDiscoverySql),
    runHogQL<NumericRow>(stageInsightsSql),
    runHogQL<NumericRow>(stageEventsSql),
  ]);
  const noDiscoveryRows = noDiscoveryResult.status === "fulfilled" ? noDiscoveryResult.value : [];
  const stageInsightRows = stageInsightResult.status === "fulfilled" ? stageInsightResult.value : [];
  const stageEventRows = stageEventResult.status === "fulfilled" ? stageEventResult.value : [];
  const noDiscovery = noDiscoveryRows[0] ?? {};
  const stageInsight = stageInsightRows[0] ?? {};
  const reachedStep2 = toNumber(noDiscovery.reached_step2);
  const noDiscoveryUsers = toNumber(noDiscovery.no_discovery_users);
  const step1Users = toNumber(stageInsight.step1_users);
  const step1FailureUsers = toNumber(stageInsight.step1_failure_users);
  const step1PopupUsers = toNumber(stageInsight.step1_popup_users);
  const step1CheckoutUsers = toNumber(stageInsight.step1_checkout_users);
  const step2Users = toNumber(stageInsight.step2_users);
  const step2PopupUsers = toNumber(stageInsight.step2_popup_users);
  const step2FailureUsers = toNumber(stageInsight.step2_failure_users);
  const step2SuccessUsers = toNumber(stageInsight.step2_success_users);
  const step2CheckoutUsers = toNumber(stageInsight.step2_checkout_users);
  const step2PaidUsers = toNumber(stageInsight.step2_paid_users);
  const step3Users = toNumber(stageInsight.step3_users);

  const detailCallouts: Callout[] = [
    {
      id: "detail-step1",
      eyebrow: "Step 1 signal",
      title: "Measure technical leakage before users even reach the main tool",
      body: step1Users
        ? `${percent((step1FailureUsers / step1Users) * 100)} of first-touch users hit a technical failure before step 2. ${percent((step1PopupUsers / step1Users) * 100)} saw a paywall or limit popup, and ${percent((step1CheckoutUsers / step1Users) * 100)} initiated checkout in the same window.`
        : "No step-1 users were returned for this identifier in the selected period.",
      tone: step1FailureUsers > 0 ? "negative" : "neutral",
      queryKey: "detail-stage-insights",
    },
    {
      id: "detail-step2",
      eyebrow: "Step 2 signal",
      title: "Focus on the main-tool experience after users land there",
      body: step2Users
        ? `${percent((step2SuccessUsers / step2Users) * 100)} of step-2 users produced a successful outcome, ${percent((step2CheckoutUsers / step2Users) * 100)} initiated checkout, and ${percent((step2FailureUsers / step2Users) * 100)} hit a technical failure after landing in the tool.`
        : "No users reached step 2, so the main-tool engagement layer could not be measured.",
      tone: step2FailureUsers > step2SuccessUsers ? "negative" : "neutral",
      queryKey: "detail-stage-insights",
    },
    {
      id: "detail-step3",
      eyebrow: "Step 3 signal",
      title: "Checkout readiness should rise faster than raw traffic",
      body: step2Users
        ? `${percent((step2PaidUsers / step2Users) * 100)} of step-2 users completed payment. Use this with the checkout initiation rate to see whether the leak is pre-paywall discovery or post-paywall conversion.`
        : "No step-2 users were detected, so checkout readiness could not be measured.",
      tone: step3Users > 0 ? "neutral" : "negative",
      queryKey: "detail-stage-insights",
    },
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

  const stageTableRows = [
    {
      stage: "Step 1 - first touch",
      users: step1Users,
      failureRate: step1Users ? percent((step1FailureUsers / step1Users) * 100) : "0%",
      popupRate: step1Users ? percent((step1PopupUsers / step1Users) * 100) : "0%",
      checkoutRate: step1Users ? percent((step1CheckoutUsers / step1Users) * 100) : "0%",
      paidRate: step1Users ? percent((step3Users / step1Users) * 100) : "0%",
    },
    {
      stage: "Step 2 - main tool",
      users: step2Users,
      failureRate: step2Users ? percent((step2FailureUsers / step2Users) * 100) : "0%",
      popupRate: step2Users ? percent((step2PopupUsers / step2Users) * 100) : "0%",
      checkoutRate: step2Users ? percent((step2CheckoutUsers / step2Users) * 100) : "0%",
      paidRate: step2Users ? percent((step2PaidUsers / step2Users) * 100) : "0%",
    },
    {
      stage: "Step 3 - paid users",
      users: step3Users,
      failureRate: step3Users ? percent((step2FailureUsers / step3Users) * 100) : "0%",
      popupRate: step3Users ? percent((step1PopupUsers / step3Users) * 100) : "0%",
      checkoutRate: step3Users ? percent((step2CheckoutUsers / step3Users) * 100) : "0%",
      paidRate: "100%",
    },
  ];

  const stageEventTableRows = stageEventRows.map((row) => ({
    stage: toStringValue(row.stage),
    event: toStringValue(row.event_name),
    users: toNumber(row.users),
    events: toNumber(row.event_count),
  }));

  const cards = [
    ...basePayload.cards,
    {
      id: "detail-no-discovery-card",
      label: "No discovery users",
      value: compactNumber(noDiscoveryUsers),
      hint: reachedStep2 ? `${percent((noDiscoveryUsers / reachedStep2) * 100)} of step 2 users` : "No step 2 users",
      queryKey: "detail-no-discovery",
    },
    {
      id: "detail-step1-failure",
      label: "Step 1 failure rate",
      value: step1Users ? percent((step1FailureUsers / step1Users) * 100) : "0%",
      hint: "Technical failures before users reached step 2",
      queryKey: "detail-stage-insights",
    },
    {
      id: "detail-step2-success",
      label: "Step 2 success rate",
      value: step2Users ? percent((step2SuccessUsers / step2Users) * 100) : "0%",
      hint: "Users who reached step 2 and produced a successful outcome",
      queryKey: "detail-stage-insights",
    },
    {
      id: "detail-checkout-rate",
      label: "Step 2 checkout rate",
      value: step2Users ? percent((step2CheckoutUsers / step2Users) * 100) : "0%",
      hint: "Users who reached step 2 and initiated checkout",
      queryKey: "detail-stage-insights",
    },
  ];

  return {
    title: `${PRODUCT_CONFIGS[request.product].label} funnel detail`,
    subtitle: `${IDENTIFIER_LABELS[identifierType]} = ${identifierValue}`,
    cards,
    tables: [
      ...basePayload.tables,
      {
        id: "detail-stage-summary",
        title: "Step-level diagnostics",
        description: "Each step shows how much technical friction, paywall exposure, and checkout intent exists inside the selected funnel.",
        queryKey: "detail-stage-insights",
        columns: [
          { key: "stage", label: "Stage" },
          { key: "users", label: "Users", align: "right" },
          { key: "failureRate", label: "Failure %", align: "right" },
          { key: "popupRate", label: "Paywall / popup %", align: "right" },
          { key: "checkoutRate", label: "Checkout initiated %", align: "right" },
          { key: "paidRate", label: "Paid %", align: "right" },
        ],
        rows: stageTableRows,
      },
      {
        id: "detail-stage-events",
        title: "Top events by funnel stage",
        description: "Useful for spotting whether users are uploading, failing, seeing pricing prompts, or initiating checkout at each stage.",
        queryKey: "detail-stage-events",
        columns: [
          { key: "stage", label: "Stage" },
          { key: "event", label: "Event" },
          { key: "users", label: "Users", align: "right" },
          { key: "events", label: "Event count", align: "right" },
        ],
        rows: stageEventTableRows,
        emptyState: "No follow-on event mix was returned for the selected funnel.",
      },
    ],
    callouts: [...basePayload.callouts, ...detailCallouts],
    queries,
    summaryText: summaryText(`${PRODUCT_CONFIGS[request.product].label} funnel detail`, cards, detailCallouts, [
      ...basePayload.tables.map((table) => ({ title: table.title, rows: table.rows })),
      { title: "Step diagnostics", rows: stageTableRows },
      { title: "Stage event mix", rows: stageEventTableRows },
    ]),
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
