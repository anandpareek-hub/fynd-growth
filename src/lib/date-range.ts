import type { ComparisonBundle, DatePreset } from "@/lib/dashboard-types";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0));
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate(), 0, 0, 0));
}

function resolveNamedWindow(preset: Exclude<DatePreset, "custom">) {
  if (preset === "24h") {
    const currentEnd = new Date();
    const currentStart = hoursAgo(24);

    return {
      label: "Last 24 hours",
      from: currentStart.toISOString(),
      to: currentEnd.toISOString(),
    };
  }

  if (preset === "thisMonth") {
    const today = new Date();
    const currentStart = startOfMonth(today);
    const currentEnd = startOfDay(addDays(today, 1));

    return {
      label: "This month",
      from: currentStart.toISOString(),
      to: currentEnd.toISOString(),
    };
  }

  if (preset === "lastMonth") {
    const thisMonthStart = startOfMonth(new Date());
    const lastMonthStart = startOfMonth(addMonths(thisMonthStart, -1));

    return {
      label: "Last month",
      from: lastMonthStart.toISOString(),
      to: thisMonthStart.toISOString(),
    };
  }

  const dayCount = preset === "180d" ? 180 : preset === "90d" ? 90 : preset === "30d" ? 30 : 7;
  const currentEnd = startOfDay(addDays(new Date(), 1));
  const currentStart = addDays(currentEnd, -dayCount);

  return {
    label: `Last ${dayCount} days`,
    from: currentStart.toISOString(),
    to: currentEnd.toISOString(),
  };
}

function previousWindowForPreset(preset: DatePreset, currentFrom: string, currentTo: string) {
  if (preset === "24h") {
    const currentEnd = new Date(currentFrom);
    const currentStart = new Date(currentEnd.getTime() - 24 * 60 * 60 * 1000);

    return {
      label: "Previous 24 hours",
      from: currentStart.toISOString(),
      to: currentEnd.toISOString(),
    };
  }

  if (preset === "thisMonth") {
    const thisMonthStart = startOfMonth(new Date(currentFrom));
    const previousMonthStart = startOfMonth(addMonths(thisMonthStart, -1));

    return {
      label: "Last month",
      from: previousMonthStart.toISOString(),
      to: thisMonthStart.toISOString(),
    };
  }

  if (preset === "lastMonth") {
    const currentStart = new Date(currentFrom);
    const previousMonthStart = startOfMonth(addMonths(currentStart, -1));

    return {
      label: `${toIsoDate(previousMonthStart)} to ${toIsoDate(addDays(currentStart, -1))}`,
      from: previousMonthStart.toISOString(),
      to: currentStart.toISOString(),
    };
  }

  if (preset === "custom") {
    const currentStart = new Date(currentFrom);
    const currentEnd = new Date(currentTo);
    const dayCount = Math.max(1, Math.round((currentEnd.getTime() - currentStart.getTime()) / DAY_IN_MS));
    const compareEnd = currentStart;
    const compareStart = addDays(compareEnd, -dayCount);

    return {
      label: `${toIsoDate(compareStart)} to ${toIsoDate(addDays(compareEnd, -1))}`,
      from: compareStart.toISOString(),
      to: compareEnd.toISOString(),
    };
  }

  const dayCount = preset === "180d" ? 180 : preset === "90d" ? 90 : preset === "30d" ? 30 : 7;
  const compareEnd = new Date(currentFrom);
  const compareStart = addDays(compareEnd, -dayCount);

  return {
    label: `Previous ${dayCount} days`,
    from: compareStart.toISOString(),
    to: compareEnd.toISOString(),
  };
}

export function resolveComparisonBundle(input: {
  preset?: DatePreset;
  comparePreset?: DatePreset | null;
  from?: string | null;
  to?: string | null;
  compareFrom?: string | null;
  compareTo?: string | null;
}): ComparisonBundle {
  const preset = input.preset ?? "7d";
  const comparePreset = input.comparePreset ?? null;

  if (preset === "custom" && input.from && input.to) {
    const currentStart = startOfDay(new Date(input.from));
    const currentEnd = startOfDay(addDays(new Date(input.to), 1));
    const compareWindow =
      comparePreset === "custom" && input.compareFrom && input.compareTo
        ? {
            label: `${input.compareFrom} to ${input.compareTo}`,
            from: startOfDay(new Date(input.compareFrom)).toISOString(),
            to: startOfDay(addDays(new Date(input.compareTo), 1)).toISOString(),
          }
        : comparePreset
          ? resolveNamedWindow(comparePreset as Exclude<DatePreset, "custom">)
          : previousWindowForPreset("custom", currentStart.toISOString(), currentEnd.toISOString());

    return {
      current: {
        label: `${toIsoDate(currentStart)} to ${toIsoDate(addDays(currentEnd, -1))}`,
        from: currentStart.toISOString(),
        to: currentEnd.toISOString(),
      },
      comparison: compareWindow,
    };
  }

  const current = resolveNamedWindow(preset as Exclude<DatePreset, "custom">);
  const comparison = comparePreset
    ? comparePreset === "custom" && input.compareFrom && input.compareTo
      ? {
          label: `${input.compareFrom} to ${input.compareTo}`,
          from: startOfDay(new Date(input.compareFrom)).toISOString(),
          to: startOfDay(addDays(new Date(input.compareTo), 1)).toISOString(),
        }
      : resolveNamedWindow(comparePreset as Exclude<DatePreset, "custom">)
    : previousWindowForPreset(preset, current.from, current.to);

  return {
    current,
    comparison,
  };
}

export function formatWindowLabel(from: string, to: string) {
  return `${from.slice(0, 10)} to ${new Date(new Date(to).getTime() - DAY_IN_MS).toISOString().slice(0, 10)}`;
}

export function calculateDelta(current: number, comparison: number) {
  if (comparison === 0) {
    return current === 0 ? 0 : 100;
  }

  return ((current - comparison) / comparison) * 100;
}
