import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureIds, getAnonId, getDistinctId, isNewVisitor, K_DID, K_SID, onSessionRotate, resetIds, resetSessionListeners, setIdentifiedId, touchSession } from "../src/ids";
import { clearStorage } from "./helpers";

describe("ids", () => {
  beforeEach(() => {
    clearStorage();
    resetSessionListeners();
    configureIds({ cookieless: false, sessionTimeoutMs: 30 * 60 * 1000 });
    vi.useRealTimers();
  });

  it("creates one anon id and keeps it in localStorage", () => {
    const a = getAnonId();
    expect(a).toMatch(/^a_/);
    expect(getAnonId()).toBe(a);
    expect(localStorage.getItem(K_DID)).toBe(a);
  });

  it("falls back to a cookie when localStorage is unavailable", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const a = getAnonId();
      expect(document.cookie).toContain(`hanu_did=${a}`);
    } finally {
      spy.mockRestore();
    }
  });

  it("rotates the session after the inactivity window and notifies listeners", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T10:00:00Z"));
    const rotated: string[] = [];
    onSessionRotate((s) => rotated.push(s));
    const s1 = touchSession();
    expect(s1.isNew).toBe(true);
    vi.setSystemTime(new Date("2026-10-19T10:20:00Z"));
    expect(touchSession()).toEqual({ id: s1.id, isNew: false });
    vi.setSystemTime(new Date("2026-10-19T10:51:00Z")); // 31 min idle
    const s3 = touchSession();
    expect(s3.isNew).toBe(true);
    expect(s3.id).not.toBe(s1.id);
    expect(rotated).toEqual([s3.id]);
    expect(sessionStorage.getItem(K_SID)).toBe(s3.id);
  });

  it("identify switches distinct id and reset forgets it but keeps the device id", () => {
    const anon = getAnonId();
    expect(getDistinctId()).toBe(anon);
    setIdentifiedId("u_42");
    expect(getDistinctId()).toBe("u_42");
    const sid = touchSession().id;
    resetIds();
    expect(getDistinctId()).toBe(anon);
    expect(touchSession().id).not.toBe(sid);
  });

  it("new visitor flag is true for the first session only", () => {
    expect(isNewVisitor()).toBe(true);
    expect(isNewVisitor()).toBe(true); // same session
    sessionStorage.clear();
    expect(isNewVisitor()).toBe(false);
  });

  it("cookieless mode stores nothing on the device", () => {
    configureIds({ cookieless: true });
    expect(getAnonId()).toBeUndefined();
    const d = getDistinctId();
    expect(d).toMatch(/^c_/);
    touchSession();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});
