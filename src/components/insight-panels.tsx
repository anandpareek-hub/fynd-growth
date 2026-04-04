"use client";

import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import type { DashboardPayload, InsightQuery } from "@/lib/dashboard-types";

type InsightPanelsProps = {
  payload: DashboardPayload;
  onOpenQuery: (queryKey: string) => void;
  detailLinkBuilder?: (identifier: string) => string | null;
  businessContext?: {
    productDescription?: string;
    icpDescription?: string;
    successFactors?: string;
  };
};

function QueryIcon({
  queryKey,
  onOpenQuery,
}: {
  queryKey?: string;
  onOpenQuery: (queryKey: string) => void;
}) {
  if (!queryKey) {
    return null;
  }

  return (
    <button
      className="query-badge"
      type="button"
      onClick={() => onOpenQuery(queryKey)}
      aria-label="Show query"
    >
      {"<?>"}
    </button>
  );
}

export function QueryModal({
  query,
  onClose,
}: {
  query: InsightQuery | null;
  onClose: () => void;
}) {
  if (!query) {
    return null;
  }

  return (
    <div className="query-overlay" onClick={onClose} role="presentation">
      <div className="query-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="query-dialog__header">
          <div>
            <p className="eyebrow">Query used for this insight</p>
            <h3>{query.label}</h3>
            <p>{query.description}</p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <pre className="query-dialog__body">{query.sql}</pre>
      </div>
    </div>
  );
}

export function InsightPanels({
  payload,
  onOpenQuery,
  detailLinkBuilder,
  businessContext,
}: InsightPanelsProps) {
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [aiError, setAiError] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);

  async function generateActions() {
    setIsGenerating(true);
    setAiError("");

    try {
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summaryText: payload.summaryText,
          scope: payload.title,
          businessContext,
          payloadSnapshot: {
            title: payload.title,
            subtitle: payload.subtitle,
            cards: payload.cards,
            callouts: payload.callouts,
            tables: payload.tables.map((table) => ({
              id: table.id,
              title: table.title,
              description: table.description,
              rows: table.rows.slice(0, 8),
            })),
          },
        }),
      });
      const data = (await response.json()) as { recommendations?: string[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to generate actions.");
      }

      setRecommendations(data.recommendations ?? []);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Failed to generate actions.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="insight-layout">
      <div className="panel-stack">
        <div className="hero-panel">
          <div>
            <p className="eyebrow">Insight workspace</p>
            <h1>{payload.title}</h1>
            <p className="hero-panel__subtitle">{payload.subtitle}</p>
          </div>
        </div>

        <section className="metrics-grid">
          {payload.cards.map((card) => (
            <article className="metric-card" key={card.id}>
              <div className="metric-card__top">
                <p className="metric-card__label">{card.label}</p>
                <QueryIcon queryKey={card.queryKey} onOpenQuery={onOpenQuery} />
              </div>
              <p className="metric-card__value">{card.value}</p>
              <div className="metric-card__bottom">
                {card.delta ? (
                  <span className={`delta-chip delta-chip--${card.deltaTone ?? "neutral"}`}>{card.delta}</span>
                ) : null}
                {card.hint ? <p className="metric-card__hint">{card.hint}</p> : null}
              </div>
            </article>
          ))}
        </section>

        {payload.callouts.map((callout) => (
          <section className="callout-card" key={callout.id}>
            <div className="section-header">
              <div>
                {callout.eyebrow ? <p className="eyebrow">{callout.eyebrow}</p> : null}
                <h2>{callout.title}</h2>
              </div>
              <QueryIcon queryKey={callout.queryKey} onOpenQuery={onOpenQuery} />
            </div>
            <p>{callout.body}</p>
          </section>
        ))}

        {payload.tables.map((table) => (
          <section className="table-card" key={table.id}>
            <div className="section-header">
              <div>
                <p className="eyebrow">Insight table</p>
                <h2>{table.title}</h2>
                {table.description ? <p>{table.description}</p> : null}
              </div>
              <QueryIcon queryKey={table.queryKey} onOpenQuery={onOpenQuery} />
            </div>

            {table.rows.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {table.columns.map((column) => (
                        <th key={column.key} className={column.align === "right" ? "align-right" : undefined}>
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, index) => {
                      const detailHref =
                        detailLinkBuilder && typeof row.identifier === "string"
                          ? detailLinkBuilder(row.identifier)
                          : null;

                      return (
                        <tr key={`${table.id}-${index}`}>
                          {table.columns.map((column) => (
                            <td key={column.key} className={column.align === "right" ? "align-right" : undefined}>
                              {column.key === "identifier" && detailHref ? (
                                <Link className="row-link" href={detailHref}>
                                  {String(row[column.key] ?? "")}
                                </Link>
                              ) : (
                                String(row[column.key] ?? "")
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">{table.emptyState ?? "No rows available."}</div>
            )}
          </section>
        ))}

        <section className="action-panel__card">
          <div className="section-header">
            <div>
              <p className="eyebrow">OpenAI action plan</p>
              <h2>Suggested next moves</h2>
              <p className="action-panel__copy">
                Generate targeted actions from the current insight payload. This uses your `OPENAI_API_KEY` on the server.
              </p>
            </div>
            <button className="primary-button" type="button" onClick={generateActions} disabled={isGenerating}>
              {isGenerating ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              {isGenerating ? "Generating..." : "Generate actions"}
            </button>
          </div>
          {aiError ? <p className="status status--error">{aiError}</p> : null}
          {recommendations.length ? (
            <ul className="recommendation-list">
              {recommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">No AI actions generated yet for this insight. Add Business Context to improve the output quality.</div>
          )}
        </section>
      </div>
    </div>
  );
}
