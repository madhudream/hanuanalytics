import { useState } from "react";
import { PERIODS, periodLabel } from "../lib/period";
import { useStats } from "../state/stats";
import { I } from "./icons";
import { Button, Dropdown, MenuItem, Toggle } from "./ui";
import { isoDate } from "../lib/format";

export function PeriodPicker({ compare = true }: { compare?: boolean }) {
  const { query, setPeriod, setCompare } = useStats();
  const [from, setFrom] = useState(query.from ?? isoDate(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(query.to ?? isoDate(new Date()));
  return (
    <div className="flex items-center gap-2">
      <Dropdown
        align="right"
        button={
          <Button>
            <I.calendar width={15} height={15} />
            {periodLabel(query.period, query.from, query.to)}
            <I.chevron width={14} height={14} className="text-t3" />
          </Button>
        }
      >
        {(close) => (
          <div className="w-[260px]">
            {PERIODS.map((p) => (
              <MenuItem key={p.value} selected={query.period === p.value} onClick={() => { setPeriod(p.value); close(); }}>{p.label}</MenuItem>
            ))}
            <div className="mt-1.5 border-t hairline px-2 pt-2 pb-1">
              <div className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-t3">Custom range</div>
              <div className="flex items-center gap-1.5">
                <input type="date" className="input !px-2 !py-1 text-[12.5px]" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="from" />
                <span className="text-t3">→</span>
                <input type="date" className="input !px-2 !py-1 text-[12.5px]" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="to" />
              </div>
              <Button size="sm" variant="primary" className="mt-2 w-full justify-center" onClick={() => { setPeriod("custom", from, to); close(); }}>Apply</Button>
            </div>
          </div>
        )}
      </Dropdown>
      {compare && (
        <label className="hidden items-center gap-2 text-[12.5px] text-t2 sm:flex">
          <Toggle checked={!!query.compare} onChange={setCompare} label="Compare with previous period" />
          Compare
        </label>
      )}
    </div>
  );
}
