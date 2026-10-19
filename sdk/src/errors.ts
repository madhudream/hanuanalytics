import type { Client } from "./client";
import { win } from "./utils";

const MAX_PER_PAGE = 10;

export function startErrors(c: Client): () => void {
  let sent = 0;
  const onError = (e: ErrorEvent): void => {
    if (sent++ >= MAX_PER_PAGE) return;
    const err = e.error as { stack?: string } | undefined;
    c.capture("$exception", {
      $message: String(e.message || "Script error").slice(0, 1000),
      $source: String(e.filename || "").slice(0, 500),
      $line: e.lineno,
      $col: e.colno,
      $stack: String(err?.stack || "").slice(0, 4096),
      $type: "error",
    });
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    if (sent++ >= MAX_PER_PAGE) return;
    const r = e.reason as { message?: string; stack?: string } | undefined;
    const message = r && typeof r === "object" ? r.message || String(r) : String(r);
    c.capture("$exception", {
      $message: String(message || "Unhandled rejection").slice(0, 1000),
      $stack: String((r && typeof r === "object" && r.stack) || "").slice(0, 4096),
      $type: "unhandledrejection",
    });
  };
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  return () => {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
  };
}
