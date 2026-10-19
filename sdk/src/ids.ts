import { cookie, ls, now, ss, uid } from "./utils";

export const K_DID = "hanu_did";
export const K_UID = "hanu_uid";
export const K_SID = "hanu_sid";
export const K_SID_TS = "hanu_sid_ts";
export const K_FIRST = "hanu_first";
export const K_NEW = "hanu_new";
export const K_OPTOUT = "hanu_optout";

const DEFAULT_TIMEOUT = 30 * 60 * 1000;

export interface IdState {
  cookieless: boolean;
  sessionTimeoutMs: number;
}

const state: IdState = { cookieless: false, sessionTimeoutMs: DEFAULT_TIMEOUT };
let sessionListeners: Array<(sid: string) => void> = [];
let memAnon: string | null = null; // cookieless: one id per page load, never persisted
let memSid: string | null = null;
let memSidTs = 0;

export function configureIds(partial: Partial<IdState>): void {
  Object.assign(state, partial);
}

export function onSessionRotate(cb: (sid: string) => void): void {
  sessionListeners.push(cb);
}

export function resetSessionListeners(): void {
  sessionListeners = [];
}

/** Device id. localStorage first, cookie as fallback. Absent in cookieless mode. */
export function getAnonId(): string | undefined {
  if (state.cookieless) return undefined;
  let id = ls.get(K_DID) || cookie.get(K_DID);
  if (!id) {
    id = uid("a_");
    if (!ls.set(K_DID, id)) cookie.set(K_DID, id, 365);
  } else if (!ls.get(K_DID)) {
    ls.set(K_DID, id);
  }
  return id;
}

export function getIdentifiedId(): string | null {
  return state.cookieless ? null : ls.get(K_UID);
}

export function getDistinctId(): string {
  const u = getIdentifiedId();
  if (u) return u;
  if (state.cookieless) {
    // one anonymous id per page load, kept in memory only
    if (!memAnon) memAnon = uid("c_");
    return memAnon;
  }
  return getAnonId() as string;
}

export function setIdentifiedId(id: string): void {
  if (state.cookieless) {
    memAnon = id;
    return;
  }
  ls.set(K_UID, id);
}

/** First visit ever on this device (persisted), and whether the current session is that first one. */
export function isNewVisitor(): boolean {
  if (state.cookieless) return false;
  if (ss.get(K_NEW) === "1") return true;
  if (ls.get(K_FIRST)) return false;
  ls.set(K_FIRST, String(now()));
  ss.set(K_NEW, "1");
  return true;
}

export interface SessionInfo {
  id: string;
  isNew: boolean;
}

function readSession(): { id: string | null; ts: number } {
  if (state.cookieless) return { id: memSid, ts: memSidTs };
  const id = ss.get(K_SID);
  const ts = Number(ss.get(K_SID_TS) || 0);
  return { id, ts };
}

function writeSession(id: string, ts: number): void {
  if (state.cookieless) {
    memSid = id;
    memSidTs = ts;
    return;
  }
  ss.set(K_SID, id);
  ss.set(K_SID_TS, String(ts));
}

/** The current session id; rotates after `sessionTimeoutMs` of inactivity. Every call counts as activity. */
export function touchSession(): SessionInfo {
  const t = now();
  const { id, ts } = readSession();
  if (id && ts && t - ts < state.sessionTimeoutMs) {
    writeSession(id, t);
    return { id, isNew: false };
  }
  const nid = uid("s_");
  writeSession(nid, t);
  if (id) for (const cb of sessionListeners) cb(nid);
  return { id: nid, isNew: true };
}

/** Peek without extending the session. */
export function peekSessionId(): string | null {
  return readSession().id;
}

/** Forget the identified user; keep the device id; start a new session. */
export function resetIds(): void {
  ls.del(K_UID);
  memAnon = null;
  const nid = uid("s_");
  writeSession(nid, now());
  ss.del(K_NEW);
  for (const cb of sessionListeners) cb(nid);
}

export function hasOptedOut(): boolean {
  return ls.get(K_OPTOUT) === "1" || cookie.get(K_OPTOUT) === "1";
}

export function setOptOut(out: boolean): void {
  if (out) {
    if (!ls.set(K_OPTOUT, "1")) cookie.set(K_OPTOUT, "1", 3650);
  } else {
    ls.del(K_OPTOUT);
    cookie.del(K_OPTOUT);
  }
}
