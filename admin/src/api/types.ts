// Mirrors docs/CONTRACT.md section 3 exactly. Do not add fields the server does not send.

export type Role = "owner" | "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface Org {
  id: string;
  name: string;
  created_at: string;
  role: Role;
}

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

export interface Project {
  id: string;
  org_id: string;
  name: string;
  public_key: string;
  domains: string[];
  allow_no_origin: boolean;
  timezone: string;
  recording: RecordingConfig;
  autocapture: AutocaptureConfig;
  cookieless: boolean;
  retention_days: number;
  recording_retention_days: number;
  created_at: string;
}

export type ProjectPatch = Partial<
  Pick<
    Project,
    | "name"
    | "domains"
    | "allow_no_origin"
    | "timezone"
    | "recording"
    | "autocapture"
    | "cookieless"
    | "retention_days"
    | "recording_retention_days"
  >
>;

export interface Member {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  joined_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  expires_at: string;
  url: string;
}

export interface Me {
  user: User;
  orgs: Org[];
  projects: Project[];
  is_instance_admin: boolean;
}

export interface SetupStatus {
  needs_setup: boolean;
  signup_open: boolean;
  version: string;
}

export type SignupMode = "invite" | "open";

export type RequestStatus = "new" | "approved" | "rejected";

/** A hosted-cloud access request from the public landing page. */
export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  website: string;
  message: string;
  created_at: string;
  status: RequestStatus;
  invite_url?: string;
  org_id?: string;
  decided_at?: string;
}

export interface SystemInfo {
  version: string;
  uptime_s: number;
  hanudb: { ok: boolean; url: string; status?: Record<string, unknown> };
  store: { kind: string; ok: boolean };
  buffer: { pending_events: number; last_flush_at: string | null };
  geo: { loaded: boolean; build: string };
  files: { events: number; recordings: number };
  live: { events_30m: number };
  signup_mode: SignupMode;
  public_url: string;
  requests_new?: number;
}

export type Period = "today" | "yesterday" | "7d" | "30d" | "90d" | "12mo" | "month" | "all" | "custom";
export type Interval = "auto" | "hour" | "day" | "week" | "month";
export type FilterOp = "is" | "is_not" | "contains";

export interface Filter {
  key: string;
  op: FilterOp;
  value: string;
}

export interface StatsQuery {
  period: Period;
  from?: string;
  to?: string;
  tz?: string;
  filters?: Filter[];
  compare?: boolean;
}

export interface Totals {
  visitors: number;
  pageviews: number;
  sessions: number;
  events: number;
  bounce_rate: number;
  avg_duration_s: number;
  views_per_session: number;
}

export interface SeriesPoint {
  t: string;
  visitors: number;
  pageviews: number;
  sessions: number;
}

export interface Overview {
  interval: Exclude<Interval, "auto">;
  totals: Totals;
  prev?: Totals | null;
  series: SeriesPoint[];
}

export type Dimension =
  | "path"
  | "hostname"
  | "entry_path"
  | "exit_path"
  | "referrer"
  | "referrer_domain"
  | "source"
  | "medium"
  | "campaign"
  | "term"
  | "content"
  | "country"
  | "region"
  | "city"
  | "browser"
  | "browser_version"
  | "os"
  | "os_version"
  | "device"
  | "screen"
  | "language"
  | "event";

export interface BreakdownRow {
  key: string;
  label?: string;
  visitors: number;
  pageviews: number;
  sessions: number;
  bounce_rate: number;
  avg_duration_s: number;
  pct: number;
}

export interface Breakdown {
  by: Dimension;
  rows: BreakdownRow[];
  total_visitors: number;
}

export interface EventRow {
  event: string;
  count: number;
  visitors: number;
  sessions: number;
}

export interface PropRow {
  key: string;
  count: number;
  visitors: number;
}

export interface FunnelStep {
  event: string;
  count: number;
  pct: number;
  drop_pct: number;
}

export interface Cohort {
  cohort: string;
  start: string;
  size: number;
  weeks: number[];
}

export interface ErrorRow {
  message: string;
  count: number;
  visitors: number;
  last_seen: string;
  sample_url: string;
}

export interface VitalStat {
  p75: number;
  good: number;
  needs_improvement: number;
  poor: number;
  n: number;
}

export interface Vitals {
  lcp: VitalStat;
  cls: VitalStat;
  inp: VitalStat;
  fcp: VitalStat;
  ttfb: VitalStat;
}

export interface LiveEvent {
  ts: string;
  event: string;
  path: string;
  country: string;
  city: string;
  browser: string;
  device: string;
  distinct_id: string;
  session_id: string;
}

export interface Live {
  online: number;
  series: { t: string; visitors: number }[];
  pages: { path: string; visitors: number }[];
  events: LiveEvent[];
}

export interface Session {
  id: string;
  session_id: string;
  distinct_id: string;
  start: string;
  end: string;
  duration_s: number;
  pageviews: number;
  events: number;
  clicks: number;
  errors: number;
  entry_path: string;
  exit_path: string;
  country: string;
  region: string;
  city: string;
  browser: string;
  os: string;
  device: string;
  referrer_domain: string;
  source: string;
  has_recording: boolean;
  rec_chunks: number;
  rec_bytes: number;
  rec_duration_s: number;
}

export interface SessionEvent {
  ts: string;
  event: string;
  path: string;
  url: string;
  props: Record<string, unknown>;
}

export interface SessionDetail {
  session: Session;
  events: SessionEvent[];
}

export interface SessionsQuery extends StatsQuery {
  has_recording?: boolean;
  distinct_id?: string;
  country?: string;
  limit?: number;
  offset?: number;
}

export interface Person {
  distinct_id: string;
  props: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
  sessions: number;
  is_identified: boolean;
}

export interface SqlResult {
  columns: { name: string; type: string }[];
  rows: unknown[][];
  took_ms: number;
  truncated: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The one interface both the real client and the mock implement. */
export interface Api {
  // auth
  setupStatus(): Promise<SetupStatus>;
  register(body: { email: string; password: string; name: string; org_name: string }): Promise<{ user: User; org: Org }>;
  updateMe(body: { name?: string; password?: string; current_password?: string }): Promise<{ user: User }>;
  setup(body: { email: string; password: string; name: string; org_name: string; project_name: string; domains: string[] }): Promise<{ user: User; org: Org; project: Project }>;
  login(email: string, password: string): Promise<{ user: User }>;
  logout(): Promise<void>;
  me(): Promise<Me>;
  // orgs & team
  createOrg(name: string): Promise<Org>;
  renameOrg(org: string, name: string): Promise<Org>;
  members(org: string): Promise<{ members: Member[]; invites: Invite[] }>;
  invite(org: string, email: string, role: Role): Promise<{ invite: Invite }>;
  revokeInvite(org: string, id: string): Promise<void>;
  setRole(org: string, userId: string, role: Role): Promise<void>;
  removeMember(org: string, userId: string): Promise<void>;
  inviteInfo(token: string): Promise<{ org_name: string; email: string; invited_by: string }>;
  acceptInvite(token: string, name: string, password: string): Promise<{ user: User }>;
  // projects
  createProject(org: string, body: { name: string; domains: string[]; timezone?: string }): Promise<Project>;
  project(id: string): Promise<Project>;
  updateProject(id: string, patch: ProjectPatch): Promise<Project>;
  rotateKey(id: string): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  // system
  system(): Promise<SystemInfo>;
  compact(): Promise<{ merged_files: number; ms: number }>;
  setSignupMode(mode: SignupMode): Promise<void>;
  // hosted-cloud access requests (instance admin only)
  requests(status: RequestStatus | "all"): Promise<{ rows: AccessRequest[] }>;
  approveRequest(id: string, orgName?: string): Promise<{ request: AccessRequest }>;
  rejectRequest(id: string): Promise<{ request: AccessRequest }>;
  // stats
  overview(id: string, q: StatsQuery, interval?: Interval): Promise<Overview>;
  breakdown(id: string, q: StatsQuery, by: Dimension, limit?: number, offset?: number): Promise<Breakdown>;
  events(id: string, q: StatsQuery, limit?: number): Promise<{ rows: EventRow[] }>;
  eventKeys(id: string, q: StatsQuery, event: string): Promise<{ keys: string[] }>;
  eventProps(id: string, q: StatsQuery, event: string, key: string, limit?: number): Promise<{ rows: PropRow[] }>;
  funnel(id: string, q: StatsQuery, steps: string[], windowDays: number): Promise<{ steps: FunnelStep[] }>;
  retention(id: string, q: StatsQuery): Promise<{ cohorts: Cohort[] }>;
  errors(id: string, q: StatsQuery, limit?: number): Promise<{ rows: ErrorRow[] }>;
  vitals(id: string, q: StatsQuery): Promise<Vitals>;
  live(id: string): Promise<Live>;
  sessions(id: string, q: SessionsQuery): Promise<{ rows: Session[]; total: number }>;
  session(id: string, sid: string): Promise<SessionDetail>;
  recording(id: string, sid: string): Promise<unknown[]>;
  persons(id: string, q: string, limit?: number, offset?: number): Promise<{ rows: Person[]; total: number }>;
  person(id: string, did: string): Promise<{ person: Person; sessions: Session[] }>;
  sql(id: string, sql: string, limit?: number): Promise<SqlResult>;
}
