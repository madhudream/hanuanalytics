//! Runtime configuration: flags or `HANU_*` environment variables. Nothing cloud-specific is compiled in;
//! the deploy scripts write these into `/etc/hanu.env` on the VM.
use clap::Parser;

#[derive(Parser, Debug, Clone)]
#[command(name = "hanu", version, about = "HanuAnalytics server: analytics + session replay on one small VM")]
pub struct Config {
    /// address to listen on
    #[arg(long, env = "HANU_LISTEN", default_value = "0.0.0.0:8090")]
    pub listen: String,

    /// durable home: gs://bucket/prefix, s3://bucket/prefix, file:///abs/dir, or mem:// (tests)
    #[arg(long, env = "HANU_BUCKET", default_value = "file://./data/bucket")]
    pub bucket: String,

    /// local cache directory (the disk is a cache; the bucket is the truth)
    #[arg(long, env = "HANU_DIR", default_value = "./data")]
    pub dir: String,

    /// HanuDB URL (metadata, sessions and persons live there)
    #[arg(long, env = "HANUDB_URL", default_value = "http://127.0.0.1:8080")]
    pub hanudb_url: String,

    /// HanuDB bearer token
    #[arg(long, env = "HANUDB_TOKEN", default_value = "")]
    pub hanudb_token: String,

    /// public URL of this server (invite links, cookie security); e.g. https://analytics.example.com
    #[arg(long, env = "HANU_PUBLIC_URL", default_value = "")]
    pub public_url: String,

    /// flush the event buffer to parquet after this many seconds of buffered data
    #[arg(long, env = "HANU_FLUSH_SECS", default_value_t = 60)]
    pub flush_secs: u64,

    /// ... or after this many buffered events, whichever comes first
    #[arg(long, env = "HANU_FLUSH_EVENTS", default_value_t = 5000)]
    pub flush_events: usize,

    /// GeoIP: "auto" (download DB-IP City Lite monthly into the bucket), "off", or a path to an .mmdb file
    #[arg(long, env = "HANU_GEO", default_value = "auto")]
    pub geo: String,

    /// memory budget for analytics queries (MB)
    #[arg(long, env = "HANU_QUERY_MEM_MB", default_value_t = 192)]
    pub query_mem_mb: usize,

    /// node name used in file names (default: hostname)
    #[arg(long, env = "HANU_NODE", default_value = "")]
    pub node: String,

    /// optional bootstrap admin "email:password" (created when no user exists; the setup page works too)
    #[arg(long, env = "HANU_BOOTSTRAP_ADMIN", default_value = "")]
    pub bootstrap_admin: String,

    /// how many days of events to keep when a project has no explicit retention
    #[arg(long, env = "HANU_DEFAULT_RETENTION_DAYS", default_value_t = 365)]
    pub default_retention_days: u32,

    /// salt for cookieless visitor hashes (rotates daily on top of this); generated and stored in HanuDB when empty
    #[arg(long, env = "HANU_SALT", default_value = "")]
    pub salt: String,

    /// Google OAuth client id ("Continue with Google" on setup, login, register and invites); empty = off
    #[arg(long, env = "HANU_GOOGLE_CLIENT_ID", default_value = "")]
    pub google_client_id: String,

    /// Google OAuth client secret
    #[arg(long, env = "HANU_GOOGLE_CLIENT_SECRET", default_value = "")]
    pub google_client_secret: String,

    /// trust X-Forwarded-For / X-Real-IP (true behind caddy / cloudflare)
    #[arg(long, env = "HANU_TRUST_PROXY", default_value_t = true)]
    pub trust_proxy: bool,
}

impl Config {
    pub fn node_name(&self) -> String {
        if !self.node.is_empty() {
            return self.node.clone();
        }
        std::env::var("HOSTNAME")
            .ok()
            .filter(|h| !h.is_empty())
            .or_else(|| sysinfo::System::host_name())
            .unwrap_or_else(|| "node".into())
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .take(16)
            .collect()
    }

    pub fn public_url(&self) -> String {
        self.public_url.trim_end_matches('/').to_string()
    }

    pub fn cookie_secure(&self) -> bool {
        self.public_url.starts_with("https://")
    }
}
