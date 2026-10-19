export interface RecordingConfig {
  enabled: boolean;
  sample_rate: number;
  mask_all_inputs: boolean;
  mask_text_selector: string;
  block_selector: string;
  min_duration_ms: number;
}

export interface AutocaptureConfig {
  pageviews: boolean;
  clicks: boolean;
  forms: boolean;
  errors: boolean;
  vitals: boolean;
  scroll: boolean;
}

/** What `GET /api/v1/config` returns. */
export interface RemoteConfig {
  ok: boolean;
  project_id: string;
  recording: RecordingConfig;
  autocapture: AutocaptureConfig;
  session_timeout_ms: number;
  cookieless: boolean;
  respect_dnt: boolean;
  server_time: number;
}

export type Props = Record<string, unknown>;

/** One event as it travels in the `events` array of `POST /api/v1/e`. */
export interface HanuEvent {
  event: string;
  ts: number;
  distinct_id: string;
  anon_id?: string;
  session_id: string;
  props: Props;
  set?: Props;
  set_once?: Props;
}

export interface InitOptions {
  /** Where the server lives; defaults to the origin of the script tag. */
  apiHost?: string;
  /** Store nothing on the device: no localStorage id, no cookie. Visitors are counted server side. */
  cookieless?: boolean;
  /** Allow session recording (still gated by the project's remote config). Default true. */
  record?: boolean;
  /** Automatic capture of pageviews, clicks, forms, errors, vitals. `false` turns all of it off. */
  autocapture?: boolean | Partial<AutocaptureConfig>;
  /** Log what the SDK does to the console. */
  debug?: boolean;
  /** Honour the Do-Not-Track browser setting regardless of the project setting. */
  respectDnt?: boolean;
  /** Inactivity window for a session, in ms. The remote config wins when present. Default 30 min. */
  sessionTimeoutMs?: number;
  /** Called with every event before it is queued; return false to drop it. */
  beforeSend?: (event: HanuEvent) => boolean | void;
}

export type Listener = (event: HanuEvent) => void;
