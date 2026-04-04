import { notFound } from "next/navigation";

import { PRODUCT_CONFIGS } from "@/lib/config";
import type { DatePreset, IdentifierType, ProductKey } from "@/lib/dashboard-types";
import { FunnelDetail } from "@/components/funnel-detail";

type PageProps = {
  params: Promise<{ product: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FunnelDetailPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const product = resolvedParams.product as ProductKey;

  if (!(product in PRODUCT_CONFIGS)) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;

  return (
    <FunnelDetail
      product={product}
      preset={(firstValue(resolvedSearchParams.preset) as DatePreset) ?? "7d"}
      identifierType={(firstValue(resolvedSearchParams.identifierType) as IdentifierType) ?? PRODUCT_CONFIGS[product].funnelIdentifierTypes[0]}
      identifierValue={firstValue(resolvedSearchParams.identifierValue) ?? ""}
      from={firstValue(resolvedSearchParams.from)}
      to={firstValue(resolvedSearchParams.to)}
      compareFrom={firstValue(resolvedSearchParams.compareFrom)}
      compareTo={firstValue(resolvedSearchParams.compareTo)}
      mainTool={firstValue(resolvedSearchParams.mainTool)}
      stepUrl={firstValue(resolvedSearchParams.stepUrl)}
    />
  );
}
