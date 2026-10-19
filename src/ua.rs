//! A small, dependency-free user-agent parser: browser, OS, device class and bot detection. It covers what an
//! analytics dashboard shows; exotic agents fall into "Other".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Ua {
    pub browser: String,
    pub browser_version: String,
    pub os: String,
    pub os_version: String,
    pub device: String, // desktop | mobile | tablet | bot
}

pub fn is_bot(ua: &str) -> bool {
    let l = ua.to_ascii_lowercase();
    if l.is_empty() {
        return true;
    }
    const BOTS: &[&str] = &[
        "bot", "crawl", "spider", "slurp", "headless", "lighthouse", "pagespeed", "pingdom", "uptimerobot", "facebookexternalhit",
        "wget", "curl/", "python-requests", "go-http-client", "java/", "okhttp", "scrapy", "phantomjs", "selenium", "puppeteer",
        "playwright", "prerender", "monitor", "archive.org", "semrush", "ahrefs", "mj12", "dataprovider", "yandex", "baidu",
        "duckduckgo", "bingpreview", "whatsapp", "telegrambot", "skypeuripreview", "embedly", "quora link preview", "chrome-lighthouse",
    ];
    BOTS.iter().any(|b| l.contains(b))
}

fn version_after(ua: &str, marker: &str) -> String {
    match ua.find(marker) {
        Some(i) => {
            let rest = &ua[i + marker.len()..];
            let v: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '_').collect();
            let v = v.replace('_', ".");
            // major.minor only
            let mut parts = v.split('.');
            match (parts.next(), parts.next()) {
                (Some(a), Some(b)) if !a.is_empty() => format!("{a}.{b}"),
                (Some(a), None) if !a.is_empty() => a.to_string(),
                _ => String::new(),
            }
        }
        None => String::new(),
    }
}

fn major(v: &str) -> String {
    v.split('.').next().unwrap_or("").to_string()
}

pub fn parse(ua: &str) -> Ua {
    let mut out = Ua::default();
    if is_bot(ua) {
        out.device = "bot".into();
        out.browser = "Bot".into();
        out.os = "Other".into();
        return out;
    }
    // ---- OS
    if ua.contains("Windows NT") {
        out.os = "Windows".into();
        let v = version_after(ua, "Windows NT ");
        out.os_version = match v.as_str() {
            "10.0" => "10/11".into(),
            "6.3" => "8.1".into(),
            "6.2" => "8".into(),
            "6.1" => "7".into(),
            _ => v,
        };
    } else if ua.contains("iPhone") || ua.contains("iPad") || ua.contains("iPod") {
        out.os = "iOS".into();
        out.os_version = major(&version_after(ua, "OS "));
    } else if ua.contains("Android") {
        out.os = "Android".into();
        out.os_version = major(&version_after(ua, "Android "));
    } else if ua.contains("CrOS") {
        out.os = "ChromeOS".into();
    } else if ua.contains("Mac OS X") {
        out.os = "macOS".into();
        let v = version_after(ua, "Mac OS X ");
        out.os_version = v;
    } else if ua.contains("Linux") || ua.contains("X11") {
        out.os = "Linux".into();
    } else {
        out.os = "Other".into();
    }
    // ---- browser (order matters: many agents claim to be Chrome and Safari)
    let (b, v) = if ua.contains("Edg/") {
        ("Edge", version_after(ua, "Edg/"))
    } else if ua.contains("EdgiOS/") {
        ("Edge", version_after(ua, "EdgiOS/"))
    } else if ua.contains("EdgA/") {
        ("Edge", version_after(ua, "EdgA/"))
    } else if ua.contains("OPR/") {
        ("Opera", version_after(ua, "OPR/"))
    } else if ua.contains("Opera") {
        ("Opera", version_after(ua, "Opera/"))
    } else if ua.contains("SamsungBrowser/") {
        ("Samsung Internet", version_after(ua, "SamsungBrowser/"))
    } else if ua.contains("Brave") {
        ("Brave", version_after(ua, "Chrome/"))
    } else if ua.contains("Vivaldi/") {
        ("Vivaldi", version_after(ua, "Vivaldi/"))
    } else if ua.contains("YaBrowser/") {
        ("Yandex", version_after(ua, "YaBrowser/"))
    } else if ua.contains("UCBrowser/") {
        ("UC Browser", version_after(ua, "UCBrowser/"))
    } else if ua.contains("FxiOS/") {
        ("Firefox", version_after(ua, "FxiOS/"))
    } else if ua.contains("Firefox/") {
        ("Firefox", version_after(ua, "Firefox/"))
    } else if ua.contains("CriOS/") {
        ("Chrome", version_after(ua, "CriOS/"))
    } else if ua.contains("Chrome/") || ua.contains("Chromium/") {
        ("Chrome", version_after(ua, "Chrome/"))
    } else if ua.contains("Safari/") && ua.contains("Version/") {
        ("Safari", version_after(ua, "Version/"))
    } else if ua.contains("MSIE") || ua.contains("Trident/") {
        ("Internet Explorer", version_after(ua, "MSIE "))
    } else {
        ("Other", String::new())
    };
    out.browser = b.into();
    out.browser_version = major(&v);
    // ---- device
    out.device = if ua.contains("iPad") || (ua.contains("Android") && !ua.contains("Mobile")) || ua.contains("Tablet") {
        "tablet".into()
    } else if ua.contains("Mobi") || ua.contains("iPhone") || ua.contains("Android") || ua.contains("iPod") || ua.contains("Windows Phone") {
        "mobile".into()
    } else {
        "desktop".into()
    };
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chrome_mac() {
        let u = parse("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
        assert_eq!(u.browser, "Chrome");
        assert_eq!(u.browser_version, "130");
        assert_eq!(u.os, "macOS");
        assert_eq!(u.device, "desktop");
    }
    #[test]
    fn safari_iphone() {
        let u = parse("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
        assert_eq!(u.browser, "Safari");
        assert_eq!(u.os, "iOS");
        assert_eq!(u.os_version, "17");
        assert_eq!(u.device, "mobile");
    }
    #[test]
    fn bot() {
        assert!(is_bot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"));
        assert_eq!(parse("curl/8.0").device, "bot");
    }
}
