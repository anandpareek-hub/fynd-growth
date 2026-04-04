import type { ComparisonBundle, DatePreset } from "@/lib/dashboard-types";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
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

export function resolveComparisonBundle(input: {
  preset?: DatePreset;
  from?: string | null;
  to?: string | null;
  compareFrom?: string | null;
  compareTo?: string | null;
}): ComparisonBundle {
  const preset = input.preset ?? "7d";

  if (preset === "24h") {
    const currentEnd = new Date();
    const currentStart = hoursAgo(24);
    const compareEnd = currentStart;
    const compareStart = hoursAgo(48);

    return {
      current: {
        label: "Last 24 hours",
        from: currentStart.toISOString(),
        to: currentEnd.toISOString(),
      },
      comparison: {
        label: "Previous 24 hours",
        from: compareStart.toISOString(),
        to: compareEnd.toISOString(),
      },
    };
  }

  if (preset === "custom" && input.from && input.to) {
    const currentStart = startOfDay(new Date(input.from));
    const currentEnd = startOfDay(addDays(new Date(input.to), 1));
    const compareStart = input.compareFrom
      ? startOfDay(new Date(input.compareFrom))
      : addDays(currentStart, -Math.max(1, Math.round((currentEnd.getTime() - currentStart.getTime()) / DAY_IN_MS)));
    const compareEnd = input.compareTo
      ? startOfDay(addDays(new Date(input.compareTo), 1))
      : currentStart;

    return {
      current: {
        label: `${toIsoDate(currentStart)} to ${toIsoDate(addDays(currentEnd, -1))}`,
        from: currentStart.toISOString(),
        to: currentEnd.toISOString(),
      },
      comparison: {
        label: `${toIsoDate(compareStart)} to ${toIsoDate(addDays(compareEnd, -1))}`,
        from: compareStart.toISOString(),
        to: compareEnd.toISOString(),
      },
    };
  }

  const dayCount = preset === "30d" ? 30 : 7;
  const currentEnd = startOfDay(addDays(new Date(), 1));
  const currentStart = addDays(currentEnd, -dayCount);
  const compareEnd = currentStart;
  const compareStart = addDays(compareEnd, -dayCount);

  return {
    current: {
      label: `Last ${dayCount} days`,
      from: currentStart.toISOString(),
      to: currentEnd.toISOString(),
    },
    comparison: {
      label: `Previous ${dayCount} days`,
      from: compareStart.toISOString(),
      to: compareEnd.toISOString(),
    },
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
