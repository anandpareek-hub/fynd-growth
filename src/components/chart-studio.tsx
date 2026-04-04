"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Bookmark, Loader2, Trash2 } from "lucide-react";

import { CHART_BREAKDOWN_LABELS } from "@/lib/config";
import type {
  ChartBreakdownProperty,
  ChartFrequency,
  ChartPayload,
  ChartType,
  DatePreset,
  InsightQuery,
  KnowledgeBase,
  ProductKey,
  SavedChart,
} from "@/lib/dashboard-types";

const SAVED_CHARTS_STORAGE_KEY = "fynd-growth.saved-charts";

const CHART_PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "90d", label: "90 Days" },
  { value: "180d", label: "180 Days" },
  { value: "custom", label: "Custom" },
];

const CHART_TYPE_OPTIONS: Array<{ value: ChartType; label: string }> = [
  { value: "line", label: "Line chart" },
  { value: "cumulative-line", label: "Cumulative line chart" },
  { value: "bar", label: "Bar chart" },
];

const CHART_FREQUENCY_OPTIONS: Array<{ value: ChartFrequency; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const SERIES_COLORS = ["#2f66f3", "#7f56d9", "#d35454", "#1f9b63", "#ed8a19", "#0e9f9a", "#7a5af8", "#343a40"];

function readSavedCharts() {
  if (typeof window === "undefined") {
    return [] as SavedChart[];
  }

  try {
    const raw = window.localStorage.getItem(SAVED_CHARTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as SavedChart[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedCharts(charts: SavedChart[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SAVED_CHARTS_STORAGE_KEY, JSON.stringify(charts));
}

function makeChartName(events: string[], productLabel: string) {
  if (!events.length) {
    return `${productLabel} chart`;
  }

  if (events.length === 1) {
    return `${productLabel}: ${events[0]}`;
  }

  return `${productLabel}: ${events[0]} + ${events.length - 1} more`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function ChartCanvas({
  payload,
  onOpenQuery,
}: {
  payload: ChartPayload;
  onOpenQuery: (query: InsightQuery) => void;
}) {
  const chartHeight = 260;
  const chartWidth = 900;
  const maxValue = Math.max(1, ...payload.series.flatMap((series) => series.points.map((point) => point.value)));

  const barWidth =
    payload.chartType === "bar"
      ? Math.max(18, Math.min(48, (chartWidth - 80) / Math.max(1, payload.labels.length * Math.max(1, payload.series.length))))
      : 0;

  return (
    <section className="table-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Chart output</p>
          <h2>{payload.title}</h2>
          <p>{payload.subtitle}</p>
        </div>
        <button className="query-badge" type="button" onClick={() => onOpenQuery(payload.query)}>
          {"<?>"}
        </button>
      </div>

      <div className="chart-card">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="chart-svg" role="img" aria-label={payload.title}>
          <line x1="56" y1="18" x2="56" y2="220" stroke="#d5dfed" strokeWidth="1" />
          <line x1="56" y1="220" x2={chartWidth - 24} y2="220" stroke="#d5dfed" strokeWidth="1" />

          {payload.labels.map((label, index) => {
            const x = 56 + ((chartWidth - 92) / Math.max(1, payload.labels.length - 1 || 1)) * index;
            return (
              <text key={label} x={x} y="244" textAnchor="middle" className="chart-axis-label">
                {label}
              </text>
            );
          })}

          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = 220 - tick * 180;
            return (
              <g key={tick}>
                <line x1="56" y1={y} x2={chartWidth - 24} y2={y} stroke="#edf2f8" strokeWidth="1" />
                <text x="46" y={y + 4} textAnchor="end" className="chart-axis-label">
                  {formatNumber(maxValue * tick)}
                </text>
              </g>
            );
          })}

          {payload.chartType === "bar"
            ? payload.series.map((series, seriesIndex) =>
                series.points.map((point, pointIndex) => {
                  const baselineX = 68 + pointIndex * ((chartWidth - 110) / Math.max(1, payload.labels.length));
                  const x = baselineX + seriesIndex * (barWidth + 4);
                  const height = (point.value / maxValue) * 180;
                  return (
                    <rect
                      key={`${series.name}-${point.label}`}
                      x={x}
                      y={220 - height}
                      width={barWidth}
                      height={height}
                      rx="6"
                      fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                      opacity="0.88"
                    />
                  );
                }),
              )
            : payload.series.map((series, seriesIndex) => {
                const path = series.points
                  .map((point, pointIndex) => {
                    const x = 56 + ((chartWidth - 92) / Math.max(1, payload.labels.length - 1 || 1)) * pointIndex;
                    const y = 220 - (point.value / maxValue) * 180;
                    return `${pointIndex === 0 ? "M" : "L"} ${x} ${y}`;
                  })
                  .join(" ");

                return (
                  <g key={series.name}>
                    <path d={path} fill="none" stroke={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]} strokeWidth="3" />
                    {series.points.map((point, pointIndex) => {
                      const x = 56 + ((chartWidth - 92) / Math.max(1, payload.labels.length - 1 || 1)) * pointIndex;
                      const y = 220 - (point.value / maxValue) * 180;
                      return (
                        <circle
                          key={`${series.name}-${point.label}`}
                          cx={x}
                          cy={y}
                          r="4"
                          fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                        />
                      );
                    })}
                  </g>
                );
              })}
        </svg>

        <div className="chart-legend">
          {payload.series.map((series, index) => (
            <div key={series.name} className="chart-legend__item">
              <span
                className="chart-legend__swatch"
                style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
              />
              <span>{series.name}</span>
              <strong>{formatNumber(series.total)}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ChartStudio({
  mode,
  product,
  productLabel,
  knowledgeBase,
  onOpenDirectQuery,
}: {
  mode: "charts" | "my-charts";
  product: ProductKey;
  productLabel: string;
  knowledgeBase: KnowledgeBase | null;
  onOpenDirectQuery: (query: InsightQuery) => void;
}) {
  const [eventOptions, setEventOptions] = useState<string[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [breakdownProperty, setBreakdownProperty] = useState<ChartBreakdownProperty>("none");
  const [chartType, setChartType] = useState<ChartType>("line");
  const [preset, setPreset] = useState<DatePreset>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [frequency, setFrequency] = useState<ChartFrequency>("daily");
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [activeSavedChartId, setActiveSavedChartId] = useState<string | null>(null);

  useEffect(() => {
    setSavedCharts(readSavedCharts());
  }, []);

  useEffect(() => {
    const knowledgeEvents = knowledgeBase?.recentEvents ?? [];
    if (knowledgeEvents.length) {
      setEventOptions(knowledgeEvents);
      return;
    }

    let cancelled = false;

    async function loadOptions() {
      try {
        const response = await fetch(`/api/chart-options?product=${product}`, { cache: "no-store" });
        const data = (await response.json()) as { events?: string[] };
        if (!cancelled) {
          setEventOptions(data.events ?? []);
        }
      } catch {
        if (!cancelled) {
          setEventOptions([]);
        }
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [knowledgeBase, product]);

  const visibleSavedCharts = useMemo(
    () => savedCharts.filter((chart) => chart.product === product),
    [product, savedCharts],
  );

  async function runChart(config?: Partial<SavedChart>) {
    const body = {
      product,
      events: config?.events ?? selectedEvents,
      breakdownProperty: config?.breakdownProperty ?? breakdownProperty,
      chartType: config?.chartType ?? chartType,
      preset: config?.preset ?? preset,
      from: config?.from ?? from,
      to: config?.to ?? to,
      frequency: config?.frequency ?? frequency,
    };

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/charts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { payload?: ChartPayload; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to generate chart.");
      }

      setPayload(data.payload ?? null);
    } catch (err) {
      setPayload(null);
      setError(err instanceof Error ? err.message : "Failed to generate chart.");
    } finally {
      setIsLoading(false);
    }
  }

  function toggleEvent(eventName: string) {
    setSelectedEvents((current) =>
      current.includes(eventName) ? current.filter((value) => value !== eventName) : [...current, eventName].slice(0, 8),
    );
  }

  function saveChart() {
    if (!selectedEvents.length) {
      setError("Select at least one event before saving.");
      return;
    }

    const nextChart: SavedChart = {
      id: `chart-${Date.now()}`,
      name: makeChartName(selectedEvents, productLabel),
      product,
      events: selectedEvents,
      breakdownProperty,
      chartType,
      preset,
      frequency,
      from,
      to,
      createdAt: new Date().toISOString(),
    };

    const nextSavedCharts = [nextChart, ...savedCharts].slice(0, 20);
    setSavedCharts(nextSavedCharts);
    persistSavedCharts(nextSavedCharts);
  }

  function removeChart(chartId: string) {
    const nextSavedCharts = savedCharts.filter((chart) => chart.id !== chartId);
    setSavedCharts(nextSavedCharts);
    persistSavedCharts(nextSavedCharts);
    if (activeSavedChartId === chartId) {
      setActiveSavedChartId(null);
      setPayload(null);
    }
  }

  return (
    <div className="panel-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">{productLabel}</p>
          <h1>{mode === "charts" ? "Charts" : "My Charts"}</h1>
          <p className="hero-panel__subtitle">
            {mode === "charts"
              ? "Build reusable PostHog charts from multiple events, optional property breakdowns, and saved chart presets."
              : "Re-open saved chart configurations and keep a reusable library of your core monitoring views."}
          </p>
        </div>
      </section>

      {mode === "charts" ? (
        <section className="control-card">
          <p className="eyebrow">Chart builder</p>
          <div className="filter-grid filter-grid--toolbar">
            <label className="field">
              <span>Time period</span>
              <select value={preset} onChange={(event) => setPreset(event.target.value as DatePreset)}>
                {CHART_PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {preset === "custom" ? (
              <>
                <label className="field">
                  <span>From</span>
                  <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                </label>
                <label className="field">
                  <span>To</span>
                  <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                </label>
              </>
            ) : null}

            <label className="field">
              <span>Chart type</span>
              <select value={chartType} onChange={(event) => setChartType(event.target.value as ChartType)}>
                {CHART_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Frequency</span>
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as ChartFrequency)}>
                {CHART_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Breakdown property</span>
              <select
                value={breakdownProperty}
                onChange={(event) => setBreakdownProperty(event.target.value as ChartBreakdownProperty)}
              >
                {Object.entries(CHART_BREAKDOWN_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="chart-event-picker">
            <p className="eyebrow">Events</p>
            <div className="chart-event-grid">
              {eventOptions.map((eventName) => (
                <button
                  key={eventName}
                  type="button"
                  className={`chip-button ${selectedEvents.includes(eventName) ? "chip-button--active" : ""}`}
                  onClick={() => toggleEvent(eventName)}
                >
                  {eventName}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-actions">
            <button className="primary-button" type="button" onClick={() => void runChart()} disabled={isLoading}>
              {isLoading ? <Loader2 size={14} className="spin" /> : <BarChart3 size={14} />}
              {isLoading ? "Generating..." : "Generate chart"}
            </button>
            <button className="ghost-button" type="button" onClick={saveChart}>
              <Bookmark size={14} />
              Save chart
            </button>
          </div>
        </section>
      ) : (
        <section className="table-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">Saved views</p>
              <h2>{productLabel} saved charts</h2>
              <p>Saved charts reuse the same query configuration and can be regenerated at any time.</p>
            </div>
          </div>

          {visibleSavedCharts.length ? (
            <div className="saved-chart-list">
              {visibleSavedCharts.map((chart) => (
                <div key={chart.id} className="saved-chart-row">
                  <div>
                    <p className="saved-chart-row__title">{chart.name}</p>
                    <p className="saved-chart-row__meta">
                      {chart.events.join(", ")} • {chart.frequency} • {chart.preset}
                    </p>
                  </div>
                  <div className="saved-chart-row__actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => {
                        setActiveSavedChartId(chart.id);
                        setSelectedEvents(chart.events);
                        setBreakdownProperty(chart.breakdownProperty);
                        setChartType(chart.chartType);
                        setPreset(chart.preset);
                        setFrequency(chart.frequency);
                        setFrom(chart.from ?? "");
                        setTo(chart.to ?? "");
                        void runChart(chart);
                      }}
                    >
                      Open
                    </button>
                    <button className="ghost-button" type="button" onClick={() => removeChart(chart.id)}>
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No saved charts yet. Build one in Charts and save it here.</div>
          )}
        </section>
      )}

      {error ? <div className="status status--error">{error}</div> : null}
      {payload ? <ChartCanvas payload={payload} onOpenQuery={onOpenDirectQuery} /> : null}
      {mode === "my-charts" && activeSavedChartId && !payload ? (
        <div className="empty-state">Open a saved chart to regenerate its data and preview the latest series.</div>
      ) : null}
    </div>
  );
}
