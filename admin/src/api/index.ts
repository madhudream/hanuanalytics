import type { Api } from "./types";
import { realApi } from "./client";
import { mockApi } from "./mock";

const params = new URLSearchParams(location.search);
export const IS_MOCK = import.meta.env.VITE_MOCK === "1" || params.get("mock") === "1";

export const api: Api = IS_MOCK ? mockApi : realApi;
export * from "./types";
