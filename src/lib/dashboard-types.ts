export type ProductKey = "pixelbin" | "watermark" | "upscale" | "revenue";

export type ViewKey =
  | "seo-funnels"
  | "console-funnels"
  | "product-performance"
  | "revenue-insights"
  | "funnel-detail";

export type DatePreset = "24h" | "7d" | "30d" | "custom";

export type IdentifierType =
  | "slug"
  | "appslug"
  | "plugin"
  | "operationID"
  | "app_name"
  | "free_property"
  | "page"
  | "other";

export type DeltaTone = "positive" | "negative" | "neutral";

export type InsightQuery = {
  key: string;
  label: string;
  sql: string;
  description: string;
};

export type MetricCard = {
  id: string;
  label: string;
  value: string;
  delta?: string;
  deltaTone?: DeltaTone;
  hint?: string;
  queryKey?: string;
};

export type TableColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

export type TableRow = Record<string, string | number | null>;

export type DataTable = {
  id: string;
  title: string;
  description?: string;
  columns: TableColumn[];
  rows: TableRow[];
  emptyState?: string;
  queryKey?: string;
};

export type Callout = {
  id: string;
  eyebrow?: string;
  title: string;
  body: string;
  tone?: DeltaTone;
  queryKey?: string;
};

export type DashboardPayload = {
  title: string;
  subtitle: string;
  cards: MetricCard[];
  tables: DataTable[];
  callouts: Callout[];
  queries: InsightQuery[];
  summaryText: string;
};

export type DashboardRequest = {
  product: ProductKey;
  view: ViewKey;
  preset?: DatePreset;
  from?: string | null;
  to?: string | null;
  compareFrom?: string | null;
  compareTo?: string | null;
  identifierType?: IdentifierType | null;
  identifierValue?: string | null;
  mainTool?: string | null;
  stepUrl?: string | null;
  consoleUrl?: string | null;
  consolidate?: boolean;
};

export type TimeWindow = {
  label: string;
  from: string;
  to: string;
};

export type ComparisonBundle = {
  current: TimeWindow;
  comparison: TimeWindow;
};
