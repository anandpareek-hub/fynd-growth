"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import {
  Filter,
  Loader2,
  RefreshCcw,
} from "lucide-react";

import {
  FREE_PROPERTY_SUGGESTIONS,
  IDENTIFIER_LABELS,
  NAV_ORDER,
  PIXELBIN_TOOL_SUGGESTIONS,
  PRODUCT_CONFIGS,
  VIEW_LABELS,
} from "@/lib/config";
import type {
  DashboardPayload,
  DatePreset,
  IdentifierType,
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
  if (identifierType === "free_property" || product === "watermark" || product === "upscale") {
    return FREE_PROPERTY_SUGGESTIONS;
  }

  return PIXELBIN_TOOL_SUGGESTIONS;
}

export function DashboardShell() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters("pixelbin"));
  const [result, setResult] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [queryKey, setQueryKey] = useState<string | null>(null);

  const activeConfig = PRODUCT_CONFIGS[filters.product];
  const showIdentifierFilters = filters.view === "seo-funnels" || filters.view === "product-performance";
  const showConsoleFilter = filters.view === "console-funnels";

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
    void runDashboard(initialFilters);
  }, []);

  const selectedQuery = useMemo(() => {
    if (!result?.payload || !queryKey) {
      return null;
    }

    return result.payload.queries.find((query) => query.key === queryKey) ?? null;
  }, [result?.payload, queryKey]);

  function applyFilters() {
    startTransition(() => {
      void runDashboard(filters);
    });
  }

  function switchProduct(product: ProductKey) {
    const nextFilters = defaultFilters(product);
    setFilters(nextFilters);
    startTransition(() => {
      void runDashboard(nextFilters);
    });
  }

  function switchView(view: ViewKey) {
    const nextFilters = { ...filters, view };
    setFilters(nextFilters);
    startTransition(() => {
      void runDashboard(nextFilters);
    });
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
        </nav>

        <div className="sidebar__footer">
          <p className="eyebrow">Notes</p>
          <p>All payment insights rely only on `paddle_transaction` API-origin events.</p>
        </div>
      </aside>

      <main className="main-layout">
        <section className="workspace-page">
          <header className="page-header">
            <div>
              <p className="eyebrow">{result?.header.section ?? activeConfig.label}</p>
              <h1>Fynd - Growth</h1>
              <p className="page-header__copy">{activeConfig.description}</p>
            </div>
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
                  onChange={(event) => setFilters((current) => ({ ...current, preset: event.target.value as DatePreset }))}
                >
                  <option value="24h">24 hours</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="custom">Custom</option>
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
                  <option value="24h">24 hours</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="custom">Custom</option>
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
                      onChange={(event) => setFilters((current) => ({ ...current, compareTo: event.target.value }))}
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
                      {suggestionList(filters.product, filters.identifierType).map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </label>
                </>
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
            {result?.error ? (
              <div className="status status--error">{result.error}</div>
            ) : null}

            {result?.payload ? (
              <InsightPanels
                payload={result.payload}
                onOpenQuery={setQueryKey}
                detailLinkBuilder={filters.view === "seo-funnels" && !filters.consolidate ? buildDetailLink : undefined}
              />
            ) : (
              <div className="empty-state empty-state--large">
                {isLoading ? "Loading dashboard..." : "Run an insight to populate the dashboard."}
              </div>
            )}
          </div>
        </section>
      </main>

      <QueryModal query={selectedQuery} onClose={() => setQueryKey(null)} />
    </div>
  );
}
