//! The event row: what one analytics event looks like once enriched, its Arrow schema, and the Parquet writer.
use anyhow::Result;
use datafusion::arrow::array::{ArrayRef, BooleanArray, Int32Array, StringArray, TimestampMillisecondArray};
use datafusion::arrow::datatypes::{DataType, Field, Schema, SchemaRef, TimeUnit};
use datafusion::arrow::record_batch::RecordBatch;
use datafusion::parquet::arrow::ArrowWriter;
use datafusion::parquet::basic::{Compression, ZstdLevel};
use datafusion::parquet::file::properties::WriterProperties;
use std::sync::{Arc, OnceLock};

#[derive(Clone, Debug, Default)]
pub struct Event {
    pub ts: i64,
    pub event: String,
    pub distinct_id: String,
    pub anon_id: String,
    pub session_id: String,
    pub visitor: String,
    pub url: String,
    pub host: String,
    pub path: String,
    pub title: String,
    pub referrer: String,
    pub referrer_domain: String,
    pub source: String,
    pub medium: String,
    pub campaign: String,
    pub term: String,
    pub content: String,
    pub country: String,
    pub region: String,
    pub city: String,
    pub browser: String,
    pub browser_version: String,
    pub os: String,
    pub os_version: String,
    pub device: String,
    pub screen_w: i32,
    pub screen_h: i32,
    pub viewport_w: i32,
    pub viewport_h: i32,
    pub language: String,
    pub timezone: String,
    pub is_new_visitor: bool,
    pub is_session_start: bool,
    pub duration_ms: i32,
    pub scroll_depth: i32,
    pub props: String,
    pub lib_version: String,
}

pub const STRING_COLS: &[&str] = &[
    "event", "distinct_id", "anon_id", "session_id", "visitor", "url", "host", "path", "title", "referrer", "referrer_domain", "source", "medium",
    "campaign", "term", "content", "country", "region", "city", "browser", "browser_version", "os", "os_version", "device", "language", "timezone",
    "props", "lib_version",
];
pub const INT_COLS: &[&str] = &["screen_w", "screen_h", "viewport_w", "viewport_h", "duration_ms", "scroll_depth"];
pub const BOOL_COLS: &[&str] = &["is_new_visitor", "is_session_start"];

pub fn schema() -> SchemaRef {
    static S: OnceLock<SchemaRef> = OnceLock::new();
    S.get_or_init(|| {
        let mut fields = vec![Field::new("ts", DataType::Timestamp(TimeUnit::Millisecond, Some("UTC".into())), false)];
        for c in STRING_COLS {
            fields.push(Field::new(*c, DataType::Utf8, true));
        }
        for c in INT_COLS {
            fields.push(Field::new(*c, DataType::Int32, true));
        }
        for c in BOOL_COLS {
            fields.push(Field::new(*c, DataType::Boolean, true));
        }
        Arc::new(Schema::new(fields))
    })
    .clone()
}

impl Event {
    fn str_col(&self, name: &str) -> &str {
        match name {
            "event" => &self.event,
            "distinct_id" => &self.distinct_id,
            "anon_id" => &self.anon_id,
            "session_id" => &self.session_id,
            "visitor" => &self.visitor,
            "url" => &self.url,
            "host" => &self.host,
            "path" => &self.path,
            "title" => &self.title,
            "referrer" => &self.referrer,
            "referrer_domain" => &self.referrer_domain,
            "source" => &self.source,
            "medium" => &self.medium,
            "campaign" => &self.campaign,
            "term" => &self.term,
            "content" => &self.content,
            "country" => &self.country,
            "region" => &self.region,
            "city" => &self.city,
            "browser" => &self.browser,
            "browser_version" => &self.browser_version,
            "os" => &self.os,
            "os_version" => &self.os_version,
            "device" => &self.device,
            "language" => &self.language,
            "timezone" => &self.timezone,
            "props" => &self.props,
            "lib_version" => &self.lib_version,
            _ => "",
        }
    }
    fn int_col(&self, name: &str) -> i32 {
        match name {
            "screen_w" => self.screen_w,
            "screen_h" => self.screen_h,
            "viewport_w" => self.viewport_w,
            "viewport_h" => self.viewport_h,
            "duration_ms" => self.duration_ms,
            "scroll_depth" => self.scroll_depth,
            _ => 0,
        }
    }
    fn bool_col(&self, name: &str) -> bool {
        match name {
            "is_new_visitor" => self.is_new_visitor,
            "is_session_start" => self.is_session_start,
            _ => false,
        }
    }
}

pub fn to_batch(events: &[Event]) -> Result<RecordBatch> {
    let mut cols: Vec<ArrayRef> = Vec::with_capacity(1 + STRING_COLS.len() + INT_COLS.len() + BOOL_COLS.len());
    cols.push(Arc::new(TimestampMillisecondArray::from(events.iter().map(|e| e.ts).collect::<Vec<_>>()).with_timezone("UTC")));
    for c in STRING_COLS {
        cols.push(Arc::new(StringArray::from(events.iter().map(|e| e.str_col(c)).collect::<Vec<&str>>())));
    }
    for c in INT_COLS {
        cols.push(Arc::new(Int32Array::from(events.iter().map(|e| e.int_col(c)).collect::<Vec<i32>>())));
    }
    for c in BOOL_COLS {
        cols.push(Arc::new(BooleanArray::from(events.iter().map(|e| e.bool_col(c)).collect::<Vec<bool>>())));
    }
    Ok(RecordBatch::try_new(schema(), cols)?)
}

pub fn writer_props() -> WriterProperties {
    WriterProperties::builder()
        .set_compression(Compression::ZSTD(ZstdLevel::try_new(3).unwrap()))
        .set_max_row_group_row_count(Some(64 * 1024))
        .set_dictionary_enabled(true)
        .build()
}

/// Serialize events (sorted by ts) to Parquet bytes.
pub fn write_parquet(mut events: Vec<Event>) -> Result<Vec<u8>> {
    events.sort_by_key(|e| e.ts);
    let batch = to_batch(&events)?;
    let mut buf = Vec::with_capacity(events.len() * 200);
    let mut w = ArrowWriter::try_new(&mut buf, schema(), Some(writer_props()))?;
    w.write(&batch)?;
    w.close()?;
    Ok(buf)
}

pub fn write_batches(batches: &[RecordBatch]) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    let mut w = ArrowWriter::try_new(&mut buf, schema(), Some(writer_props()))?;
    for b in batches {
        w.write(b)?;
    }
    w.close()?;
    Ok(buf)
}

/// Known referrers -> a friendly source name (used when there is no utm_source).
pub fn classify_source(referrer_domain: &str) -> String {
    let d = referrer_domain.trim_start_matches("www.").to_ascii_lowercase();
    if d.is_empty() {
        return "Direct".into();
    }
    let table: &[(&str, &str)] = &[
        ("google.", "Google"), ("bing.com", "Bing"), ("duckduckgo.com", "DuckDuckGo"), ("yahoo.", "Yahoo"), ("baidu.com", "Baidu"),
        ("yandex.", "Yandex"), ("ecosia.org", "Ecosia"), ("brave.com", "Brave Search"), ("t.co", "X (Twitter)"), ("twitter.com", "X (Twitter)"),
        ("x.com", "X (Twitter)"), ("facebook.com", "Facebook"), ("fb.com", "Facebook"), ("instagram.com", "Instagram"), ("linkedin.com", "LinkedIn"),
        ("lnkd.in", "LinkedIn"), ("reddit.com", "Reddit"), ("youtube.com", "YouTube"), ("youtu.be", "YouTube"), ("pinterest.", "Pinterest"),
        ("github.com", "GitHub"), ("producthunt.com", "Product Hunt"), ("news.ycombinator.com", "Hacker News"), ("chatgpt.com", "ChatGPT"),
        ("chat.openai.com", "ChatGPT"), ("perplexity.ai", "Perplexity"), ("claude.ai", "Claude"), ("gemini.google.com", "Gemini"), ("t.me", "Telegram"),
        ("telegram.", "Telegram"), ("whatsapp.com", "WhatsApp"), ("medium.com", "Medium"), ("substack.com", "Substack"), ("quora.com", "Quora"),
        ("tiktok.com", "TikTok"), ("snapchat.com", "Snapchat"), ("wikipedia.org", "Wikipedia"), ("mail.google.com", "Gmail"), ("outlook.live.com", "Outlook"),
        ("threads.net", "Threads"), ("bsky.app", "Bluesky"), ("mastodon.", "Mastodon"), ("discord.com", "Discord"), ("slack.com", "Slack"), ("dev.to", "DEV"),
        ("stackoverflow.com", "Stack Overflow"), ("bitly.com", "Bitly"), ("bit.ly", "Bitly"),
    ];
    for (needle, name) in table {
        if d == *needle || d.ends_with(&format!(".{needle}")) || (needle.ends_with('.') && d.starts_with(needle)) || d.contains(&format!(".{needle}")) {
            return (*name).into();
        }
    }
    d
}

pub fn country_name(code: &str) -> &'static str {
    match code {
        "IN" => "India", "US" => "United States", "GB" => "United Kingdom", "CA" => "Canada", "AU" => "Australia", "DE" => "Germany", "FR" => "France",
        "BR" => "Brazil", "JP" => "Japan", "CN" => "China", "RU" => "Russia", "NL" => "Netherlands", "ES" => "Spain", "IT" => "Italy", "SG" => "Singapore",
        "AE" => "United Arab Emirates", "ID" => "Indonesia", "PK" => "Pakistan", "BD" => "Bangladesh", "NG" => "Nigeria", "KE" => "Kenya", "ZA" => "South Africa",
        "MX" => "Mexico", "AR" => "Argentina", "CO" => "Colombia", "CL" => "Chile", "SE" => "Sweden", "NO" => "Norway", "DK" => "Denmark", "FI" => "Finland",
        "PL" => "Poland", "CZ" => "Czechia", "AT" => "Austria", "CH" => "Switzerland", "BE" => "Belgium", "IE" => "Ireland", "PT" => "Portugal", "GR" => "Greece",
        "TR" => "Türkiye", "IL" => "Israel", "SA" => "Saudi Arabia", "EG" => "Egypt", "KR" => "South Korea", "TW" => "Taiwan", "HK" => "Hong Kong", "TH" => "Thailand",
        "VN" => "Vietnam", "PH" => "Philippines", "MY" => "Malaysia", "NZ" => "New Zealand", "LK" => "Sri Lanka", "NP" => "Nepal", "UA" => "Ukraine", "RO" => "Romania",
        "HU" => "Hungary", "QA" => "Qatar", "KW" => "Kuwait", "OM" => "Oman", "BH" => "Bahrain", "MA" => "Morocco", "GH" => "Ghana", "ET" => "Ethiopia", "PE" => "Peru",
        "VE" => "Venezuela", "EC" => "Ecuador", "BG" => "Bulgaria", "HR" => "Croatia", "RS" => "Serbia", "SK" => "Slovakia", "SI" => "Slovenia", "LT" => "Lithuania",
        "LV" => "Latvia", "EE" => "Estonia", "IS" => "Iceland", "LU" => "Luxembourg", "KZ" => "Kazakhstan", "UZ" => "Uzbekistan", "IR" => "Iran", "IQ" => "Iraq",
        "JO" => "Jordan", "LB" => "Lebanon", "TN" => "Tunisia", "DZ" => "Algeria", "TZ" => "Tanzania", "UG" => "Uganda", "MM" => "Myanmar", "KH" => "Cambodia",
        "" => "Unknown",
        _ => "",
    }
}
