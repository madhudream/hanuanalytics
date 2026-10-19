import Foundation
import UIKit

/// HanuAnalytics for native iOS (hanu-swift 0.1.0): the Swift side of
/// docs/CONTRACT.md §2 "Native apps". One file, no dependencies: copy it into
/// an app target (docs/SDK.md, "Native iOS").
///
/// What it sends to `POST <host>/api/v1/e`, batched:
/// - `$pageview` per screen (`screen(_:title:)`), with `$current_url`
///   `app://<app id><path>`, so the dashboard's Pages and Hostname
///   breakdowns keep the app apart from the website;
/// - `$pageleave` with `$duration_ms` when the screen changes or the app
///   leaves the foreground;
/// - `$identify`, `capture(_:_:)` events and `$exception`.
/// There is no session replay on native (rrweb is web only).
///
/// Requests carry no Origin; they name the app in `X-Hanu-App`, which the
/// project must list under Settings → Domains → Native apps. Ids live in
/// UserDefaults: an anonymous device id, the identified member id, and a
/// session id that renews after 30 minutes away. Never throws, never blocks
/// the main thread; a failed batch is retried with the next flush.
final class HanuAnalytics: @unchecked Sendable {
    static let shared = HanuAnalytics()
    static let libVersion = "0.1.0"

    private let queue = DispatchQueue(label: "hanu.analytics")
    private var token = ""
    private var host = URL(string: "https://analytics.carebun.com")!
    private var appId = ""
    private var userAgent = ""
    private var screenSize = (w: 0, h: 0)
    private var enabled = false

    private var pending: [[String: Any]] = []
    private var flushing = false
    private var timer: DispatchSourceTimer?

    private var currentPath: String?
    private var currentTitle: String?
    private var screenStart = Date()

    private let defaults = UserDefaults.standard
    private enum Key {
        static let anon = "hanu.anon_id", distinct = "hanu.distinct_id", session = "hanu.session_id"
        static let lastSeen = "hanu.last_seen_ms", seenBefore = "hanu.seen_before"
    }
    private static let sessionTimeoutMs: Int64 = 30 * 60 * 1000
    private static let maxQueue = 1000
    private static let batchSize = 50

    private init() {}

    // MARK: setup

    /// Starts the client; call once at launch, on the main thread (it reads the screen and device).
    /// An empty token leaves it off: every call becomes a no-op.
    @MainActor
    func configure(token: String, host: URL? = nil, appId: String? = nil) {
        let token = token.trimmingCharacters(in: .whitespaces)
        let appId = (appId?.isEmpty == false ? appId : Bundle.main.bundleIdentifier) ?? ""
        let ua = Self.makeUserAgent()
        let size = UIScreen.main.bounds.size
        queue.sync {
            self.token = token
            if let host { self.host = host }
            self.appId = appId
            self.userAgent = ua
            self.screenSize = (Int(size.width), Int(size.height))
            self.enabled = !token.isEmpty && !appId.isEmpty
        }
        guard !token.isEmpty, !appId.isEmpty else { return }
        startTimer()
        let center = NotificationCenter.default
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.didEnterBackground()
        }
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.willEnterForeground()
        }
    }

    // MARK: public API

    /// A screen came on: `path` is the web-style path (`/events/kc/x`).
    func screen(_ path: String, title: String? = nil) {
        queue.async {
            guard self.enabled, path != self.currentPath else { return }
            self.leaveCurrentScreen()
            let previous = self.currentPath
            self.currentPath = path
            self.currentTitle = title
            self.screenStart = Date()
            var props: [String: Any] = ["$current_url": self.url(for: path)]
            if let title { props["$title"] = title }
            if let previous { props["$prev_url"] = self.url(for: previous) }
            self.enqueue("$pageview", props)
        }
    }

    /// A named product event, e.g. `capture("event_rsvp_updated", ["event_slug": slug])`.
    func capture(_ event: String, _ props: [String: Any] = [:]) {
        queue.async {
            guard self.enabled else { return }
            var p = props
            if let path = self.currentPath, p["$current_url"] == nil { p["$current_url"] = self.url(for: path) }
            self.enqueue(event, p)
        }
    }

    /// Ties this device to a member; `set` becomes person properties.
    func identify(_ id: String, set: [String: Any] = [:]) {
        queue.async {
            guard self.enabled, !id.isEmpty, id != self.defaults.string(forKey: Key.distinct) else { return }
            let anon = self.anonId()
            self.defaults.set(id, forKey: Key.distinct)
            self.enqueue("$identify", ["$anon_distinct_id": anon], set: set)
        }
    }

    /// On sign-out: a new anonymous visitor and session from here on.
    func reset() {
        queue.async {
            guard self.enabled else { return }
            self.flushLocked()
            self.defaults.removeObject(forKey: Key.distinct)
            self.defaults.removeObject(forKey: Key.anon)
            self.defaults.removeObject(forKey: Key.session)
        }
    }

    /// Reports a caught error to the Errors page.
    func captureError(_ error: Error, context: String? = nil) {
        let ns = error as NSError
        var props: [String: Any] = ["$message": String(describing: error).prefix(1000).description, "$type": "\(ns.domain) \(ns.code)"]
        if let context { props["$source"] = context }
        capture("$exception", props)
    }

    /// Sends what is queued now.
    func flush() {
        queue.async { self.flushLocked() }
    }

    // MARK: lifecycle

    private func didEnterBackground() {
        let task = UIApplication.shared.beginBackgroundTask(withName: "hanu.flush")
        queue.async {
            self.leaveCurrentScreen()
            self.flushLocked {
                DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(task) }
            }
        }
    }

    /// Coming back counts as viewing the screen again (a new session after 30 minutes away).
    private func willEnterForeground() {
        queue.async {
            guard self.enabled, let path = self.currentPath else { return }
            self.currentPath = nil
            self.screen(path, title: self.currentTitle)
        }
    }

    // MARK: internals (on `queue`)

    private func leaveCurrentScreen() {
        guard let path = currentPath else { return }
        let ms = Int(Date().timeIntervalSince(screenStart) * 1000)
        guard ms > 0 else { return }
        enqueue("$pageleave", ["$current_url": url(for: path), "$duration_ms": ms])
    }

    private func url(for path: String) -> String {
        let p = path.hasPrefix("/") ? path : "/" + path
        return "app://\(appId)\(p)"
    }

    private func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private func anonId() -> String {
        if let a = defaults.string(forKey: Key.anon) { return a }
        let a = "a_" + Self.randomId()
        defaults.set(a, forKey: Key.anon)
        return a
    }

    /// The session id, renewed after 30 minutes without an event; true when this event starts it.
    private func session(at ts: Int64) -> (String, Bool) {
        let last = Int64(defaults.integer(forKey: Key.lastSeen))
        defaults.set(Int(ts), forKey: Key.lastSeen)
        if let s = defaults.string(forKey: Key.session), ts - last < Self.sessionTimeoutMs { return (s, false) }
        let s = "s_" + Self.randomId()
        defaults.set(s, forKey: Key.session)
        return (s, true)
    }

    private func enqueue(_ event: String, _ props: [String: Any], set: [String: Any] = [:]) {
        let ts = now()
        let anon = anonId()
        let (sessionId, start) = session(at: ts)
        let isNew = !defaults.bool(forKey: Key.seenBefore)
        if isNew { defaults.set(true, forKey: Key.seenBefore) }
        var p = props
        p["$screen_width"] = screenSize.w
        p["$screen_height"] = screenSize.h
        p["$viewport_width"] = screenSize.w
        p["$viewport_height"] = screenSize.h
        p["$language"] = Locale.preferredLanguages.first ?? "en"
        p["$timezone"] = TimeZone.current.identifier
        p["$is_new_visitor"] = isNew
        p["$session_start"] = start
        p["$app_version"] = Self.appVersion
        p["$device_model"] = Self.deviceModel
        var e: [String: Any] = [
            "event": event, "ts": ts, "anon_id": anon, "session_id": sessionId,
            "distinct_id": defaults.string(forKey: Key.distinct) ?? anon, "props": p,
        ]
        if !set.isEmpty { e["set"] = set }
        pending.append(e)
        if pending.count > Self.maxQueue { pending.removeFirst(pending.count - Self.maxQueue) }
        if pending.count >= Self.batchSize { flushLocked() }
    }

    private func flushLocked(_ done: (() -> Void)? = nil) {
        guard enabled, !flushing, !pending.isEmpty else { done?(); return }
        let batch = Array(pending.prefix(Self.batchSize))
        let body: [String: Any] = ["token": token, "sent_at": now(), "lib": "hanu-swift", "lib_version": Self.libVersion, "events": batch]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else {
            pending.removeFirst(batch.count)
            done?()
            return
        }
        var req = URLRequest(url: host.appendingPathComponent("api/v1/e"))
        req.httpMethod = "POST"
        req.httpBody = data
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(appId, forHTTPHeaderField: "X-Hanu-App")
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        flushing = true
        URLSession.shared.dataTask(with: req) { _, response, error in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            self.queue.async {
                self.flushing = false
                // Sent, or refused for good (bad body, wrong key, app not listed): drop. Network or 5xx: keep for the next flush.
                if error == nil, status < 500 { self.pending.removeFirst(min(batch.count, self.pending.count)) }
                if error == nil, status < 500, self.pending.count >= Self.batchSize { self.flushLocked(done) } else { done?() }
            }
        }.resume()
    }

    private func startTimer() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 10, repeating: 10)
        t.setEventHandler { [weak self] in self?.flushLocked() }
        t.resume()
        queue.sync { timer?.cancel(); timer = t }
    }

    // MARK: device facts

    private static let appVersion: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"

    private static let deviceModel: String = {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }()

    /// `<App>/<version> (<iPhone|iPad>; iOS <version>; Scale/<n>) hanu-swift/<sdk>`: the server's UA parser
    /// reads this as "iOS app" on a phone or tablet.
    @MainActor
    private static func makeUserAgent() -> String {
        let name = (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "App").replacingOccurrences(of: " ", with: "")
        let kind = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        let os = UIDevice.current.systemVersion
        let scale = UIScreen.main.scale
        return "\(name)/\(appVersion) (\(kind); iOS \(os); Scale/\(String(format: "%.2f", scale))) hanu-swift/\(libVersion)"
    }

    private static func randomId() -> String {
        let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<24).map { _ in chars[Int.random(in: 0..<chars.count)] })
    }
}
