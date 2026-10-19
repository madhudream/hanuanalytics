import { useState } from "react";
import { I } from "./icons";
import { Button, Input } from "./ui";

const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(:\d+)?$/i;
const APP_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/i;

/** Chips editor for allowed domains, or (kind="app") native app ids such as com.example.ios. */
export function DomainsEditor({ value, onChange, kind = "domain" }: { value: string[]; onChange: (v: string[]) => void; kind?: "domain" | "app" }) {
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const app = kind === "app";
  const add = () => {
    const d = app ? draft.trim().toLowerCase() : draft.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) return;
    if (!(app ? APP_RE : DOMAIN_RE).test(d)) {
      setErr(app ? "Enter an app id like com.example.ios" : "Enter a hostname like example.com or *.example.com");
      return;
    }
    if (!value.includes(d)) onChange([...value, d]);
    setDraft("");
    setErr("");
  };
  return (
    <div>
      <div className="flex gap-2">
        <Input value={draft} placeholder={app ? "com.example.ios" : "example.com"} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} aria-label={app ? "App id" : "Domain"} />
        <Button onClick={add}><I.plus width={14} height={14} />Add</Button>
      </div>
      {err && <div className="mt-1 text-[12px] text-critical">{err}</div>}
      {!!value.length && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {value.map((d) => (
            <li key={d} className="chip"><span className="font-mono text-[12px]">{d}</span><button onClick={() => onChange(value.filter((x) => x !== d))} aria-label={`Remove ${d}`}><I.close width={12} height={12} /></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
