import type { Period } from "../api/types";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12mo", label: "Last 12 months" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
];

export function periodLabel(period: Period, from?: string, to?: string): string {
  if (period === "custom") return from && to ? `${from} → ${to}` : "Custom";
  return PERIODS.find((p) => p.value === period)?.label ?? period;
}

/** [start, end] as Dates in local time for a period (end is exclusive-ish: end of day). */
export function periodRange(period: Period, from?: string, to?: string, now = new Date()): [Date, Date] {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 86400000;
  switch (period) {
    case "today":
      return [d0, new Date(d0.getTime() + day)];
    case "yesterday":
      return [new Date(d0.getTime() - day), d0];
    case "7d":
      return [new Date(d0.getTime() - 6 * day), new Date(d0.getTime() + day)];
    case "30d":
      return [new Date(d0.getTime() - 29 * day), new Date(d0.getTime() + day)];
    case "90d":
      return [new Date(d0.getTime() - 89 * day), new Date(d0.getTime() + day)];
    case "12mo":
      return [new Date(now.getFullYear() - 1, now.getMonth(), 1), new Date(d0.getTime() + day)];
    case "month":
      return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(d0.getTime() + day)];
    case "all":
      return [new Date(now.getFullYear() - 2, now.getMonth(), 1), new Date(d0.getTime() + day)];
    case "custom": {
      const f = from ? new Date(from + "T00:00:00") : new Date(d0.getTime() - 6 * day);
      const t = to ? new Date(to + "T00:00:00") : d0;
      return [f, new Date(t.getTime() + day)];
    }
  }
}

export function autoInterval(period: Period, from?: string, to?: string): "hour" | "day" | "week" | "month" {
  const [a, b] = periodRange(period, from, to);
  const days = (b.getTime() - a.getTime()) / 86400000;
  if (days <= 1.5) return "hour";
  if (days <= 92) return "day";
  if (days <= 400) return "week";
  return "month";
}
