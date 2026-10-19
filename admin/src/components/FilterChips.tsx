import { useStats } from "../state/stats";
import { I } from "./icons";
import { countryName } from "../lib/countries";

const KEY_LABEL: Record<string, string> = {
  path: "Page", entry_path: "Entry page", exit_path: "Exit page", hostname: "Hostname", referrer: "Referrer", referrer_domain: "Referrer",
  source: "Source", medium: "Medium", campaign: "Campaign", term: "Term", content: "Content", country: "Country", region: "Region", city: "City",
  browser: "Browser", browser_version: "Browser version", os: "OS", os_version: "OS version", device: "Device", screen: "Screen", language: "Language", event: "Event",
};
const OP_LABEL = { is: "is", is_not: "is not", contains: "contains" } as const;

export function FilterChips() {
  const { query, removeFilter, clearFilters } = useStats();
  const fs = query.filters ?? [];
  if (!fs.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {fs.map((f, i) => (
        <span key={`${f.key}${f.op}${f.value}`} className="chip">
          <span className="text-t2">{KEY_LABEL[f.key] ?? f.key}</span>
          <span className="text-t3">{OP_LABEL[f.op]}</span>
          <strong className="font-medium">{f.key === "country" ? countryName(f.value) : f.value}</strong>
          <button onClick={() => removeFilter(i)} aria-label={`Remove filter ${f.key}`}><I.close width={12} height={12} /></button>
        </span>
      ))}
      {fs.length > 1 && (
        <button className="btn btn-ghost btn-sm text-t2" onClick={clearFilters}>Clear all</button>
      )}
    </div>
  );
}
