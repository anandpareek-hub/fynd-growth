"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { PRODUCT_CONFIGS } from "@/lib/config";
import type { DashboardPayload, DatePreset, IdentifierType, ProductKey } from "@/lib/dashboard-types";
import { InsightPanels, QueryModal } from "@/components/insight-panels";

type FunnelDetailProps = {
  product: ProductKey;
  preset: DatePreset;
  comparePreset: DatePreset;
  identifierType: IdentifierType;
  identifierValue: string;
  from?: string;
  to?: string;
  compareFrom?: string;
  compareTo?: string;
  mainTool?: string;
  stepUrl?: string;
};

type DashboardResponse = {
  payload?: DashboardPayload;
  error?: string;
};

function buildUrl(props: FunnelDetailProps) {
  const searchParams = new URLSearchParams({
    product: props.product,
    view: "funnel-detail",
    preset: props.preset,
    comparePreset: props.comparePreset,
    identifierType: props.identifierType,
    identifierValue: props.identifierValue,
  });

  if (props.from) searchParams.set("from", props.from);
  if (props.to) searchParams.set("to", props.to);
  if (props.compareFrom) searchParams.set("compareFrom", props.compareFrom);
  if (props.compareTo) searchParams.set("compareTo", props.compareTo);
  if (props.mainTool) searchParams.set("mainTool", props.mainTool);
  if (props.stepUrl) searchParams.set("stepUrl", props.stepUrl);

  return `/api/dashboard?${searchParams.toString()}`;
}

export function FunnelDetail(props: FunnelDetailProps) {
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [queryKey, setQueryKey] = useState<string | null>(null);

  useEffect(() => {
    async function loadDetail() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(buildUrl(props), { cache: "no-store" });
        const data = (await response.json()) as DashboardResponse;

        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load funnel detail.");
        }

        setPayload(data.payload ?? null);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load funnel detail.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadDetail();
  }, [props]);

  const selectedQuery = useMemo(() => {
    if (!payload || !queryKey) {
      return null;
    }

    return payload.queries.find((query) => query.key === queryKey) ?? null;
  }, [payload, queryKey]);

  return (
    <div className="detail-page">
      <div className="detail-page__top">
        <Link className="ghost-button" href="/">
          <ArrowLeft size={16} />
          Back to dashboard
        </Link>
        <div>
          <p className="eyebrow">{PRODUCT_CONFIGS[props.product].label}</p>
          <h1>Funnel detail</h1>
        </div>
      </div>

      {error ? <div className="status status--error">{error}</div> : null}
      {isLoading ? (
        <div className="empty-state empty-state--large">
          <Loader2 size={18} className="spin" />
          Loading funnel detail...
        </div>
      ) : null}

      {payload ? <InsightPanels payload={payload} onOpenQuery={setQueryKey} /> : null}

      <QueryModal query={selectedQuery} onClose={() => setQueryKey(null)} />
    </div>
  );
}
