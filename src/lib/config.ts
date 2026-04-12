import { BarChart3, DollarSign, ImageUpscale, Sparkles, WandSparkles } from "lucide-react";

import type {
  ChartBreakdownProperty,
  CustomScope,
  IdentifierType,
  ProductKey,
  ViewKey,
} from "@/lib/dashboard-types";

export type ProductConfig = {
  key: ProductKey;
  label: string;
  description: string;
  accent: string;
  icon: typeof BarChart3;
  revenueToken: string | null;
  defaultConsoleUrl: string;
  funnelIdentifierTypes: IdentifierType[];
  performanceIdentifierTypes: IdentifierType[];
  views: ViewKey[];
  stepTwoDefault: string;
};

export const POSTHOG_HOST = "https://us.posthog.com";
export const POSTHOG_PROJECT_ID = "54090";

export const PRODUCT_CONFIGS: Record<ProductKey, ProductConfig> = {
  pixelbin: {
    key: "pixelbin",
    label: "Pixelbin",
    description: "SEO funnels, product health, and revenue signals across core AI tools.",
    accent: "#7bb0ff",
    icon: Sparkles,
    revenueToken: "PB",
    defaultConsoleUrl: "studio/ai-image-generator",
    funnelIdentifierTypes: ["slug", "appslug", "plugin", "operationID", "page"],
    performanceIdentifierTypes: ["slug", "appslug", "plugin", "operationID", "app_name", "page"],
    views: ["seo-funnels", "console-funnels", "product-performance", "revenue-insights"],
    stepTwoDefault: "studio",
  },
  watermark: {
    key: "watermark",
    label: "Watermarkremover",
    description: "Free-property funnels, limit pop-up drop-offs, and issue tracking.",
    accent: "#64d6c5",
    icon: WandSparkles,
    revenueToken: "WM",
    defaultConsoleUrl: "mini-studio/watermarkremover",
    funnelIdentifierTypes: ["free_property", "other"],
    performanceIdentifierTypes: ["free_property", "page", "other"],
    views: ["seo-funnels", "product-performance", "revenue-insights"],
    stepTwoDefault: "LIMIT_POPUP_TRIGGRED",
  },
  upscale: {
    key: "upscale",
    label: "Upscale Media",
    description: "Upscale acquisition paths, quality drops, and revenue mix.",
    accent: "#f3aa66",
    icon: ImageUpscale,
    revenueToken: "UM",
    defaultConsoleUrl: "mini-studio/upscaler",
    funnelIdentifierTypes: ["free_property", "other"],
    performanceIdentifierTypes: ["free_property", "page", "other"],
    views: ["seo-funnels", "product-performance", "revenue-insights"],
    stepTwoDefault: "LIMIT_POPUP_TRIGGRED",
  },
  revenue: {
    key: "revenue",
    label: "Revenue",
    description: "Plan mix, primary tool attribution, and revenue shifts from paddle.",
    accent: "#b79cff",
    icon: DollarSign,
    revenueToken: null,
    defaultConsoleUrl: "studio/ai-image-generator",
    funnelIdentifierTypes: ["app_name", "page"],
    performanceIdentifierTypes: ["app_name", "page"],
    views: ["revenue-insights"],
    stepTwoDefault: "studio",
  },
};

export const NAV_ORDER: ProductKey[] = ["pixelbin", "watermark", "upscale", "revenue"];

export const VIEW_LABELS: Record<ViewKey, string> = {
  "seo-funnels": "SEO Funnels",
  "console-funnels": "Console Funnels",
  "product-performance": "Product Performance",
  "revenue-insights": "Revenue Insights",
  "funnel-detail": "Funnel Detail",
};

export const IDENTIFIER_LABELS: Record<IdentifierType, string> = {
  slug: "Slug",
  appslug: "App slug",
  plugin: "Plugin",
  operationID: "Operation ID",
  app_name: "App name",
  free_property: "Free property",
  page: "Page",
  other: "Other",
};

export const FAILURE_IGNORE_PATTERNS = [
  "credit",
  "limit",
  "rate limit",
  "quota",
  "no credits",
  "exhausted",
  "content safety",
  "responsible ai",
  "usage guidelines",
  "usage policy",
  "content policy",
  "content checker",
  "content violation",
  "safety violation",
  "nsfw",
  "blocked due to",
  "operation cancelled",
  "not a valid tiktok link",
];

/**
 * Events that look like failures but are actually usage limits — not technical errors.
 * Must be excluded from SEO funnel step1 (argMin) and from error tables.
 */
export const LIMIT_EVENTS = [
  "DYNAMIC_APP_DAILY_LIMIT_EXCEEDED",
  "DYNAMIC_APP_VIDEO_LIMIT_REACHED",
  "IMG_TO_IMG_FREE_TRIAL_LIMIT_REACHED",
];

export const PIXELBIN_TOOL_SUGGESTIONS = [
  "video-generator",
  "ai-image-generator",
  "ai-image-editor",
  "magic-canvas",
];

export const FREE_PROPERTY_SUGGESTIONS = [
  "watermarkremover",
  "video-watermark-remover",
  "upscalemedia",
  "image-upscaler",
];

export const CUSTOM_SCOPE_LABELS: Record<CustomScope, string> = {
  funnel: "Funnel",
  "product-performance": "Product Performance",
  revenue: "Revenue",
  checkout: "Checkout",
  errors: "Errors",
  acquisition: "Acquisition",
  retention: "Retention",
};

export const CHART_BREAKDOWN_LABELS: Record<ChartBreakdownProperty, string> = {
  none: "No breakdown",
  appslug: "App slug",
  current_url: "Current URL",
  app_name: "App name",
  page: "Page",
  slug: "Slug",
  operationID: "Operation ID",
  free_property: "Free property",
};
