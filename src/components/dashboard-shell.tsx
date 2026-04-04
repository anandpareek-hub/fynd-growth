"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import {
  BriefcaseBusiness,
  Filter,
  FileUp,
  Loader2,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

import { ChartStudio } from "@/components/chart-studio";
import {
  CUSTOM_SCOPE_LABELS,
  FREE_PROPERTY_SUGGESTIONS,
  IDENTIFIER_LABELS,
  NAV_ORDER,
  PIXELBIN_TOOL_SUGGESTIONS,
  PRODUCT_CONFIGS,
  VIEW_LABELS,
} from "@/lib/config";
import type {
  CustomScope,
  DashboardPayload,
  DatePreset,
  IdentifierType,
  InsightQuery,
  KnowledgeBase,
  ProductKey,
  ViewKey,
} from "@/lib/dashboard-types";
import { InsightPanels, QueryModal } from "@/components/insight-panels";

type DashboardResponse = {
  header: {
    appName: string;
    section: string;
    viewLabel: string;
    description: string;
  };
  payload?: DashboardPayload;
  error?: string;
};

type CustomInsightResponse = {
  payload?: DashboardPayload;
  error?: string;
};

type FilterState = {
  product: ProductKey;
  view: ViewKey;
  preset: DatePreset;
  comparePreset: DatePreset;
  from: string;
  to: string;
  compareFrom: string;
  compareTo: string;
  identifierType: IdentifierType;
  identifierValue: string;
  mainTool: string;
  stepUrl: string;
  consoleUrl: string;
  consolidate: boolean;
};

type ContextKey = "productDescription" | "icpDescription" | "successFactors";

type BusinessContextState = {
  productDescription: string;
  productDescriptionFileName: string;
  icpDescription: string;
  icpDescriptionFileName: string;
  successFactors: string;
  successFactorsFileName: string;
};

const BUSINESS_CONTEXT_STORAGE_KEY = "fynd-growth.business-context";
const KNOWLEDGE_BASE_STORAGE_KEY = "fynd-growth.knowledge-base";

const EMPTY_BUSINESS_CONTEXT: BusinessContextState = {
  productDescription: "",
  productDescriptionFileName: "",
  icpDescription: "",
  icpDescriptionFileName: "",
  successFactors: "",
  successFactorsFileName: "",
};

const PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "180d", label: "180 days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "custom", label: "Custom" },
];

function defaultFilters(product: ProductKey): FilterState {
  const config = PRODUCT_CONFIGS[product];

  return {
    product,
    view: config.views[0],
    preset: "7d",
    comparePreset: "7d",
    from: "",
    to: "",
    compareFrom: "",
    compareTo: "",
    identifierType: config.funnelIdentifierTypes[0],
    identifierValue: "",
    mainTool: "",
    stepUrl: product === "pixelbin" ? "studio" : "",
    consoleUrl: config.defaultConsoleUrl,
    consolidate: false,
  };
}

function buildDashboardUrl(filters: FilterState) {
  const searchParams = new URLSearchParams({
    product: filters.product,
    view: filters.view,
    preset: filters.preset,
    comparePreset: filters.comparePreset,
    identifierType: filters.identifierType,
  });

  if (filters.from) searchParams.set("from", filters.from);
  if (filters.to) searchParams.set("to", filters.to);
  if (filters.compareFrom) searchParams.set("compareFrom", filters.compareFrom);
  if (filters.compareTo) searchParams.set("compareTo", filters.compareTo);
  if (filters.identifierValue) searchParams.set("identifierValue", filters.identifierValue);
  if (filters.mainTool) searchParams.set("mainTool", filters.mainTool);
  if (filters.stepUrl) searchParams.set("stepUrl", filters.stepUrl);
  if (filters.consoleUrl) searchParams.set("consoleUrl", filters.consoleUrl);
  if (filters.consolidate) searchParams.set("consolidate", "true");

  return `/api/dashboard?${searchParams.toString()}`;
}

function suggestionList(product: ProductKey, identifierType: IdentifierType) {
  if (identifierType === "operationID") {
    return [];
  }

  if (identifierType === "free_property" || product === "watermark" || product === "upscale") {
    return FREE_PROPERTY_SUGGESTIONS;
  }

  return PIXELBIN_TOOL_SUGGESTIONS;
}

function readStoredBusinessContext() {
  if (typeof window === "undefined") {
    return EMPTY_BUSINESS_CONTEXT;
  }

  try {
    const raw = window.localStorage.getItem(BUSINESS_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return EMPTY_BUSINESS_CONTEXT;
    }

    const parsed = JSON.parse(raw) as Partial<BusinessContextState>;
    return {
      ...EMPTY_BUSINESS_CONTEXT,
      ...parsed,
    };
  } catch {
    return EMPTY_BUSINESS_CONTEXT;
  }
}

function readStoredKnowledgeBase() {
  if (typeof window === "undefined") {
    return {} as Partial<Record<ProductKey, KnowledgeBase>>;
  }

  try {
    const raw = window.localStorage.getItem(KNOWLEDGE_BASE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as Partial<Record<ProductKey, KnowledgeBase>>;
  } catch {
    return {};
  }
}

function formatUploadedContext(fileName: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return `Reference file uploaded: ${fileName}`;
  }

  return `Reference file: ${fileName}\n${trimmed.slice(0, 9000)}`;
}

function BusinessContextEditor({
  value,
  onChange,
  onUpload,
}: {
  value: BusinessContextState;
  onChange: (key: ContextKey, nextValue: string) => void;
  onUpload: (key: ContextKey, file: File | null) => Promise<void>;
}) {
  return (
    <div className="panel-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Business Context</p>
          <h1>Business Context</h1>
          <p className="hero-panel__subtitle">
            Ground the LLM action plans in product reality: what the product does, who the ICP is, and what success
            means for this funnel.
          </p>
        </div>
      </section>

      {[
        {
          key: "productDescription" as const,
          title: "Product Description",
          fileName: value.productDescriptionFileName,
          placeholder:
            "Describe the product, core jobs-to-be-done, value proposition, and where the selected funnels fit in the journey.",
        },
        {
          key: "icpDescription" as const,
          title: "ICP Description",
          fileName: value.icpDescriptionFileName,
          placeholder:
            "Describe the target audience, buying triggers, use cases, objections, and what signals indicate a qualified user.",
        },
        {
          key: "successFactors" as const,
          title: "Key Success Factors",
          fileName: value.successFactorsFileName,
          placeholder:
            "List the outcomes that matter most: e.g. more users reaching payment popup, lower technical failure rate, faster console activation, stronger paywall CTR.",
        },
      ].map((field) => (
        <section className="callout-card" key={field.key}>
          <div className="section-header">
            <div>
              <p className="eyebrow">Context block</p>
              <h2>{field.title}</h2>
              {field.fileName ? <p>Attached reference: {field.fileName}</p> : null}
            </div>
          </div>

          <div className="context-form">
            <textarea
              className="context-textarea"
              value={value[field.key]}
              placeholder={field.placeholder}
              onChange={(event) => onChange(field.key, event.target.value)}
            />

            <label className="ghost-button context-upload">
              <FileUp size={14} />
              Upload file
              <input
                className="sr-only"
                type="file"
                accept=".txt,.md,.json,.csv,.html,.pdf,.doc,.docx"
                onChange={(event) => void onUpload(field.key, event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </section>
      ))}
    </div>
  );
}

function CustomAnalysisEditor({
  productLabel,
  scope,
  question,
  preset,
  comparePreset,
  from,
  to,
  compareFrom,
  compareTo,
  onScopeChange,
  onQuestionChange,
  onDateChange,
  onGenerate,
  onReset,
  payload,
  error,
  isLoading,
  onOpenQuery,
  businessContext,
}: {
  productLabel: string;
  scope: CustomScope;
  question: string;
  preset: DatePreset;
  comparePreset: DatePreset;
  from: string;
  to: string;
  compareFrom: string;
  compareTo: string;
  onScopeChange: (value: CustomScope) => void;
  onQuestionChange: (value: string) => void;
  onDateChange: (patch: Partial<FilterState>) => void;
  onGenerate: () => void;
  onReset: () => void;
  payload: DashboardPayload | null;
  error: string;
  isLoading: boolean;
  onOpenQuery: (queryKey: string) => void;
  businessContext: BusinessContextState;
}) {
  return (
    <div className="panel-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">{productLabel}</p>
          <h1>Custom analysis</h1>
          <p className="hero-panel__subtitle">
            Ask a specific question, choose the business scope, and let the model write a PostHog query for the current product.
          </p>
        </div>
      </section>

      <section className="control-card">
        <p className="eyebrow">Custom prompt</p>
        <div className="filter-grid filter-grid--toolbar">
          <label className="field">
            <span>Current window</span>
            <select value={preset} onChange={(event) => onDateChange({ preset: event.target.value as DatePreset })}>
              {PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {preset === "custom" ? (
            <>
              <label className="field">
                <span>Current from</span>
                <input type="date" value={from} onChange={(event) => onDateChange({ from: event.target.value })} />
              </label>
              <label className="field">
                <span>Current to</span>
                <input type="date" value={to} onChange={(event) => onDateChange({ to: event.target.value })} />
              </label>
            </>
          ) : null}

          <label className="field">
            <span>Comparison window</span>
            <select
              value={comparePreset}
              onChange={(event) => onDateChange({ comparePreset: event.target.value as DatePreset })}
            >
              {PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {comparePreset === "custom" ? (
            <>
              <label className="field">
                <span>Compare from</span>
                <input
                  type="date"
                  value={compareFrom}
                  onChange={(event) => onDateChange({ compareFrom: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Compare to</span>
                <input
                  type="date"
                  value={compareTo}
                  onChange={(event) => onDateChange({ compareTo: event.target.value })}
                />
              </label>
            </>
          ) : null}

          <label className="field">
            <span>Scope</span>
            <select value={scope} onChange={(event) => onScopeChange(event.target.value as CustomScope)}>
              {Object.entries(CUSTOM_SCOPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--full">
            <span>Question</span>
            <textarea
              className="context-textarea"
              value={question}
              placeholder="Example: For video-generator this month, what is the biggest leak between payment popup and checkout initiated, and which events are most correlated with that drop?"
              onChange={(event) => onQuestionChange(event.target.value)}
            />
          </label>
        </div>

        <div className="filter-actions">
          <button className="primary-button" type="button" onClick={onGenerate} disabled={isLoading || !question.trim()}>
            {isLoading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            {isLoading ? "Generating..." : "Generate insights"}
          </button>
          <button className="ghost-button" type="button" onClick={onReset}>
            <Filter size={14} />
            Reset
          </button>
        </div>
      </section>

      {error ? <div className="status status--error">{error}</div> : null}
      {payload ? (
        <InsightPanels payload={payload} onOpenQuery={onOpenQuery} businessContext={businessContext} />
      ) : (
        <div className="empty-state empty-state--large">
          Ask a question about funnel performance, revenue, retention, checkout, or errors to generate a custom PostHog analysis.
        </div>
      )}
    </div>
  );
}

export function DashboardShell() {
  const [activePanel, setActivePanel] = useState<
    "dashboard" | "business-context" | "custom" | "charts" | "my-charts"
  >("dashboard");
  const [filters, setFilters] = useState<FilterState>(defaultFilters("pixelbin"));
  const [businessContext, setBusinessContext] = useState<BusinessContextState>(EMPTY_BUSINESS_CONTEXT);
  const [knowledgeBaseMap, setKnowledgeBaseMap] = useState<Partial<Record<ProductKey, KnowledgeBase>>>({});
  const [identifierSuggestions, setIdentifierSuggestions] = useState<string[]>([]);
  const [result, setResult] = useState<DashboardResponse | null>(null);
  const [customScope, setCustomScope] = useState<CustomScope>("funnel");
  const [customQuestion, setCustomQuestion] = useState("");
  const [customResult, setCustomResult] = useState<CustomInsightResponse | null>(null);
  const [customError, setCustomError] = useState("");
  const [isCustomLoading, setIsCustomLoading] = useState(false);
  const [isRefreshingKnowledge, setIsRefreshingKnowledge] = useState(false);
  const [knowledgeStatus, setKnowledgeStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [queryKey, setQueryKey] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState<InsightQuery | null>(null);

  const activeConfig = PRODUCT_CONFIGS[filters.product];
  const showIdentifierFilters = filters.view === "seo-funnels" || filters.view === "product-performance";
  const showConsoleFilter = filters.view === "console-funnels";
  const currentKnowledgeBase = knowledgeBaseMap[filters.product] ?? null;

  async function runDashboard(nextFilters: FilterState) {
    setIsLoading(true);

    try {
      const response = await fetch(buildDashboardUrl(nextFilters), { cache: "no-store" });
      const data = (await response.json()) as DashboardResponse;
      setResult(data);
    } catch (error) {
      setResult({
        header: {
          appName: "Fynd - Growth",
          section: PRODUCT_CONFIGS[nextFilters.product].label,
          viewLabel: VIEW_LABELS[nextFilters.view],
          description: PRODUCT_CONFIGS[nextFilters.product].description,
        },
        error: error instanceof Error ? error.message : "Failed to load dashboard.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const initialFilters = defaultFilters("pixelbin");
    setBusinessContext(readStoredBusinessContext());
    setKnowledgeBaseMap(readStoredKnowledgeBase());
    void runDashboard(initialFilters);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(BUSINESS_CONTEXT_STORAGE_KEY, JSON.stringify(businessContext));
  }, [businessContext]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(KNOWLEDGE_BASE_STORAGE_KEY, JSON.stringify(knowledgeBaseMap));
  }, [knowledgeBaseMap]);

  useEffect(() => {
    const currentKnowledge = knowledgeBaseMap[filters.product];

    if (filters.identifierType !== "operationID") {
      const baseSuggestions = suggestionList(filters.product, filters.identifierType);
      const knowledgeSuggestions =
        filters.identifierType === "slug"
          ? currentKnowledge?.recentSlugs ?? []
          : filters.identifierType === "app_name"
            ? currentKnowledge?.recentApps ?? []
            : filters.identifierType === "page"
              ? currentKnowledge?.recentPages ?? []
              : filters.identifierType === "free_property"
                ? currentKnowledge?.recentFreeProperties ?? []
                : [];

      setIdentifierSuggestions(Array.from(new Set([...knowledgeSuggestions, ...baseSuggestions])));
      return;
    }

    let cancelled = false;

    async function loadSuggestions() {
      try {
        const response = await fetch(
          `/api/suggestions?product=${filters.product}&identifierType=${filters.identifierType}`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as { suggestions?: string[] };

        if (!cancelled) {
          setIdentifierSuggestions(
            Array.from(new Set([...(currentKnowledge?.recentOperationIds ?? []), ...(data.suggestions ?? [])])),
          );
        }
      } catch {
        if (!cancelled) {
          setIdentifierSuggestions(currentKnowledge?.recentOperationIds ?? []);
        }
      }
    }

    void loadSuggestions();

    return () => {
      cancelled = true;
    };
  }, [filters.product, filters.identifierType, knowledgeBaseMap]);

  const activePayload = activePanel === "custom" ? customResult?.payload ?? null : result?.payload ?? null;

  const selectedQuery = useMemo(() => {
    if (!activePayload || !queryKey) {
      return null;
    }

    return activePayload.queries.find((query) => query.key === queryKey) ?? null;
  }, [activePayload, queryKey]);

  async function refreshKnowledgeBase() {
    setIsRefreshingKnowledge(true);
    setKnowledgeStatus("");

    try {
      const response = await fetch("/api/knowledge-refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product: filters.product }),
      });
      const data = (await response.json()) as { knowledgeBase?: KnowledgeBase; error?: string };

      if (!response.ok || !data.knowledgeBase) {
        throw new Error(data.error ?? "Knowledge refresh failed.");
      }

      setKnowledgeBaseMap((current) => ({
        ...current,
        [filters.product]: data.knowledgeBase as KnowledgeBase,
      }));
      setKnowledgeStatus(`Knowledge base refreshed from the last 3 days of ${activeConfig.label} events.`);
    } catch (error) {
      setKnowledgeStatus(error instanceof Error ? error.message : "Knowledge refresh failed.");
    } finally {
      setIsRefreshingKnowledge(false);
    }
  }

  function applyFilters() {
    startTransition(() => {
      void runDashboard(filters);
    });
  }

  async function runCustomInsights() {
    setIsCustomLoading(true);
    setCustomError("");

    try {
      const response = await fetch("/api/custom-insights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product: filters.product,
          scope: customScope,
          question: customQuestion,
          preset: filters.preset,
          comparePreset: filters.comparePreset,
          from: filters.from,
          to: filters.to,
          compareFrom: filters.compareFrom,
          compareTo: filters.compareTo,
          businessContext,
          knowledgeBase: currentKnowledgeBase,
        }),
      });
      const data = (await response.json()) as CustomInsightResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to generate custom insights.");
      }

      setCustomResult(data);
    } catch (error) {
      setCustomError(error instanceof Error ? error.message : "Failed to generate custom insights.");
      setCustomResult(null);
    } finally {
      setIsCustomLoading(false);
    }
  }

  function switchProduct(product: ProductKey) {
    setActivePanel("dashboard");
    const nextFilters = defaultFilters(product);
    setFilters(nextFilters);
    startTransition(() => {
      void runDashboard(nextFilters);
    });
  }

  function switchView(view: ViewKey) {
    setActivePanel("dashboard");
    const nextFilters = { ...filters, view };
    setFilters(nextFilters);
    startTransition(() => {
      void runDashboard(nextFilters);
    });
  }

  function updateBusinessContext(key: ContextKey, nextValue: string) {
    setBusinessContext((current) => ({
      ...current,
      [key]: nextValue.slice(0, 12000),
    }));
  }

  async function uploadBusinessContext(key: ContextKey, file: File | null) {
    if (!file) {
      return;
    }

    let content = `Reference file uploaded: ${file.name}`;

    try {
      const text = await file.text();
      const isReadableText =
        file.type.startsWith("text/") ||
        [".txt", ".md", ".json", ".csv", ".html"].some((suffix) => file.name.toLowerCase().endsWith(suffix));

      content = isReadableText ? formatUploadedContext(file.name, text) : `Reference file uploaded: ${file.name}`;
    } catch {
      content = `Reference file uploaded: ${file.name}`;
    }

    setBusinessContext((current) => ({
      ...current,
      [`${key}FileName`]: file.name,
      [key]: current[key]
        ? `${current[key].trim()}\n\n${content}`.slice(0, 12000)
        : content,
    }) as BusinessContextState);
  }

  function buildDetailLink(identifier: string) {
    const searchParams = new URLSearchParams({
      view: "funnel-detail",
      preset: filters.preset,
      comparePreset: filters.comparePreset,
      identifierType: filters.identifierType,
      identifierValue: identifier,
    });

    if (filters.from) searchParams.set("from", filters.from);
    if (filters.to) searchParams.set("to", filters.to);
    if (filters.compareFrom) searchParams.set("compareFrom", filters.compareFrom);
    if (filters.compareTo) searchParams.set("compareTo", filters.compareTo);
    if (filters.mainTool) searchParams.set("mainTool", filters.mainTool);
    if (filters.stepUrl) searchParams.set("stepUrl", filters.stepUrl);

    return `/funnel/${filters.product}?${searchParams.toString()}`;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__icon">F</div>
          <div>
            <p className="brand__title">Fynd - Growth</p>
            <p className="brand__subtitle">PostHog growth command center</p>
          </div>
        </div>

        <nav className="sidebar__nav">
          {NAV_ORDER.map((product) => {
            const config = PRODUCT_CONFIGS[product];
            const Icon = config.icon;
            const active = filters.product === product;

            return (
              <button
                key={product}
                className={`sidebar__item ${active ? "sidebar__item--active" : ""}`}
                type="button"
                onClick={() => switchProduct(product)}
              >
                <Icon size={16} />
                <span>{config.label}</span>
              </button>
            );
          })}

          <button
            className={`sidebar__item ${activePanel === "custom" ? "sidebar__item--active" : ""}`}
            type="button"
            onClick={() => setActivePanel("custom")}
          >
            <Sparkles size={16} />
            <span>Custom</span>
          </button>

          <button
            className={`sidebar__item ${activePanel === "charts" ? "sidebar__item--active" : ""}`}
            type="button"
            onClick={() => setActivePanel("charts")}
          >
            <RefreshCcw size={16} />
            <span>Charts</span>
          </button>

          <button
            className={`sidebar__item ${activePanel === "my-charts" ? "sidebar__item--active" : ""}`}
            type="button"
            onClick={() => setActivePanel("my-charts")}
          >
            <Filter size={16} />
            <span>My Charts</span>
          </button>

          <button
            className={`sidebar__item ${activePanel === "business-context" ? "sidebar__item--active" : ""}`}
            type="button"
            onClick={() => setActivePanel("business-context")}
          >
            <BriefcaseBusiness size={16} />
            <span>Business Context</span>
          </button>
        </nav>

        <div className="sidebar__footer">
          <p className="eyebrow">Notes</p>
          <p>Total revenue uses all `paddle_transaction` events. New revenue uses only API-origin transactions.</p>
          {currentKnowledgeBase ? (
            <p>Knowledge base: refreshed {new Date(currentKnowledgeBase.generatedAt).toLocaleString("en-US")}</p>
          ) : null}
        </div>
      </aside>

      <main className="main-layout">
        <section className="workspace-page">
          {activePanel === "business-context" ? (
            <BusinessContextEditor
              value={businessContext}
              onChange={updateBusinessContext}
              onUpload={uploadBusinessContext}
            />
          ) : activePanel === "charts" ? (
            <ChartStudio
              mode="charts"
              product={filters.product}
              productLabel={activeConfig.label}
              knowledgeBase={currentKnowledgeBase}
              onOpenDirectQuery={setManualQuery}
            />
          ) : activePanel === "my-charts" ? (
            <ChartStudio
              mode="my-charts"
              product={filters.product}
              productLabel={activeConfig.label}
              knowledgeBase={currentKnowledgeBase}
              onOpenDirectQuery={setManualQuery}
            />
          ) : activePanel === "custom" ? (
            <CustomAnalysisEditor
              productLabel={activeConfig.label}
              scope={customScope}
              question={customQuestion}
              preset={filters.preset}
              comparePreset={filters.comparePreset}
              from={filters.from}
              to={filters.to}
              compareFrom={filters.compareFrom}
              compareTo={filters.compareTo}
              onScopeChange={setCustomScope}
              onQuestionChange={setCustomQuestion}
              onDateChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
              onGenerate={() => void runCustomInsights()}
              onReset={() => {
                setCustomQuestion("");
                setCustomScope("funnel");
                setCustomResult(null);
                setCustomError("");
              }}
              payload={customResult?.payload ?? null}
              error={customError}
              isLoading={isCustomLoading}
              onOpenQuery={setQueryKey}
              businessContext={businessContext}
            />
          ) : (
            <>
              <header className="page-header page-header--with-actions">
                <div>
                  <p className="eyebrow">{result?.header.section ?? activeConfig.label}</p>
                  <h1>Fynd - Growth</h1>
                  <p className="page-header__copy">{activeConfig.description}</p>
                  {knowledgeStatus ? <p className="page-header__meta">{knowledgeStatus}</p> : null}
                </div>
                <button className="ghost-button" type="button" onClick={() => void refreshKnowledgeBase()} disabled={isRefreshingKnowledge}>
                  {isRefreshingKnowledge ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />}
                  {isRefreshingKnowledge ? "Refreshing..." : "Refresh knowledge base"}
                </button>
              </header>

              <div className="view-strip">
                <div className="tab-row">
                  {activeConfig.views.map((view) => (
                    <button
                      key={view}
                      className={`tab-pill ${filters.view === view ? "tab-pill--active" : ""}`}
                      type="button"
                      onClick={() => switchView(view)}
                    >
                      {VIEW_LABELS[view]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-card">
                <p className="eyebrow">Filters</p>
                <div className="filter-grid filter-grid--toolbar">
                  <label className="field">
                    <span>Current window</span>
                    <select
                      value={filters.preset}
                      onChange={(event) =>
                        setFilters((current) => ({ ...current, preset: event.target.value as DatePreset }))
                      }
                    >
                      {PRESET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {filters.preset === "custom" ? (
                    <>
                      <label className="field">
                        <span>Current from</span>
                        <input
                          type="date"
                          value={filters.from}
                          onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                        />
                      </label>
                      <label className="field">
                        <span>Current to</span>
                        <input
                          type="date"
                          value={filters.to}
                          onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                        />
                      </label>
                    </>
                  ) : null}

                  <label className="field">
                    <span>Comparison window</span>
                    <select
                      value={filters.comparePreset}
                      onChange={(event) =>
                        setFilters((current) => ({ ...current, comparePreset: event.target.value as DatePreset }))
                      }
                    >
                      {PRESET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {filters.comparePreset === "custom" ? (
                    <>
                      <label className="field">
                        <span>Compare from</span>
                        <input
                          type="date"
                          value={filters.compareFrom}
                          onChange={(event) =>
                            setFilters((current) => ({ ...current, compareFrom: event.target.value }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Compare to</span>
                        <input
                          type="date"
                          value={filters.compareTo}
                          onChange={(event) =>
                            setFilters((current) => ({ ...current, compareTo: event.target.value }))
                          }
                        />
                      </label>
                    </>
                  ) : null}

                  {showIdentifierFilters ? (
                    <>
                      <label className="field">
                        <span>Identifier type</span>
                        <select
                          value={filters.identifierType}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              identifierType: event.target.value as IdentifierType,
                              identifierValue: "",
                            }))
                          }
                        >
                          {(filters.view === "seo-funnels"
                            ? activeConfig.funnelIdentifierTypes
                            : activeConfig.performanceIdentifierTypes
                          ).map((type) => (
                            <option key={type} value={type}>
                              {IDENTIFIER_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="field">
                        <span>Identifier value</span>
                        <input
                          list="identifier-suggestions"
                          placeholder="Optional"
                          value={filters.identifierValue}
                          onChange={(event) =>
                            setFilters((current) => ({ ...current, identifierValue: event.target.value }))
                          }
                        />
                        <datalist id="identifier-suggestions">
                          {identifierSuggestions.map((option) => (
                            <option key={option} value={option} />
                          ))}
                        </datalist>
                      </label>
                    </>
                  ) : null}

                  {filters.view === "seo-funnels" && filters.product === "pixelbin" ? (
                    <label className="field">
                      <span>Step 2 pageview URL contains</span>
                      <input
                        placeholder="Example: studio/ai-image-generator"
                        value={filters.stepUrl}
                        onChange={(event) => setFilters((current) => ({ ...current, stepUrl: event.target.value }))}
                      />
                    </label>
                  ) : null}

                  {showConsoleFilter ? (
                    <label className="field field--wide">
                      <span>Console URL contains</span>
                      <input
                        placeholder="Example: studio/ai-image-generator"
                        value={filters.consoleUrl}
                        onChange={(event) => setFilters((current) => ({ ...current, consoleUrl: event.target.value }))}
                      />
                    </label>
                  ) : null}
                </div>

                <div className="filter-actions">
                  <button className="primary-button" type="button" onClick={applyFilters} disabled={isLoading}>
                    {isLoading ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />}
                    {isLoading ? "Generating..." : "Generate"}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      const nextFilters = defaultFilters(filters.product);
                      setFilters(nextFilters);
                      startTransition(() => {
                        void runDashboard(nextFilters);
                      });
                    }}
                  >
                    <Filter size={14} />
                    Reset
                  </button>
                </div>
              </div>

              <div className="content-panel">
                {result?.error ? <div className="status status--error">{result.error}</div> : null}

                {result?.payload ? (
                  <InsightPanels
                    payload={result.payload}
                    onOpenQuery={setQueryKey}
                    detailLinkBuilder={filters.view === "seo-funnels" && !filters.consolidate ? buildDetailLink : undefined}
                    businessContext={businessContext}
                  />
                ) : (
                  <div className="empty-state empty-state--large">
                    {isLoading ? "Loading dashboard..." : "Run an insight to populate the dashboard."}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      <QueryModal
        query={selectedQuery ?? manualQuery}
        onClose={() => {
          setQueryKey(null);
          setManualQuery(null);
        }}
      />
    </div>
  );
}
