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
  comparePreset?: DatePreset | null;
  from?: string | null;
  to?: string | null;
  compareFrom?: string | null;
  compareTo?: string | null;
}): ComparisonBundle {
  const preset = input.preset ?? "7d";
  const comparePreset = input.comparePreset ?? null;

  if (preset === "24h") {
    const currentEnd = new Date();
    const currentStart = hoursAgo(24);
    const compareLengthHours = comparePreset === "7d" ? 24 * 7 : comparePreset === "30d" ? 24 * 30 : 24;
    const compareEnd = currentStart;
    const compareStart = new Date(compareEnd.getTime() - compareLengthHours * 60 * 60 * 1000);

    return {
      current: {
        label: "Last 24 hours",
        from: currentStart.toISOString(),
        to: currentEnd.toISOString(),
      },
      comparison: {
        label:
          comparePreset && comparePreset !== "custom"
            ? `Previous ${comparePreset === "24h" ? "24 hours" : comparePreset === "7d" ? "7 days" : "30 days"}`
            : "Previous 24 hours",
        from: compareStart.toISOString(),
        to: compareEnd.toISOString(),
      },
    };
  }

  if (preset === "custom" && input.from && input.to) {
    const currentStart = startOfDay(new Date(input.from));
    const currentEnd = startOfDay(addDays(new Date(input.to), 1));
    const customDayLength = Math.max(1, Math.round((currentEnd.getTime() - currentStart.getTime()) / DAY_IN_MS));
    const compareDayCount =
      comparePreset === "24h" ? 1 : comparePreset === "30d" ? 30 : comparePreset === "7d" ? 7 : customDayLength;
    const compareStart = input.compareFrom
      ? startOfDay(new Date(input.compareFrom))
      : addDays(currentStart, -compareDayCount);
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
  const compareDayCount =
    comparePreset === "24h" ? 1 : comparePreset === "30d" ? 30 : comparePreset === "7d" ? 7 : dayCount;
  const compareEnd = currentStart;
  const compareStart = addDays(compareEnd, -compareDayCount);

  return {
    current: {
      label: `Last ${dayCount} days`,
      from: currentStart.toISOString(),
      to: currentEnd.toISOString(),
    },
    comparison: {
      label: `Previous ${compareDayCount} days`,
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
