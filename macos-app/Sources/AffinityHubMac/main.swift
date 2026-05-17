import AppKit
import Foundation
import Network
import UniformTypeIdentifiers
import WebKit

private let bundledSiteDirectory = "site"
private let liveSiteURL = URL(string: "https://affinityhub.js.org/")!

final class LocalSiteServer {
    private let siteRoot: URL
    private let upstreamBaseURL: URL
    private let queue = DispatchQueue(label: "org.affinityhub.local-site-server")
    private var listener: NWListener?

    init(siteRoot: URL, upstreamBaseURL: URL) {
        self.siteRoot = siteRoot
        self.upstreamBaseURL = upstreamBaseURL
    }

    func start() throws -> URL {
        let listener = try NWListener(using: .tcp, on: .any)
        let ready = DispatchSemaphore(value: 0)
        var startupError: Error?

        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                ready.signal()
            case .failed(let error):
                startupError = error
                ready.signal()
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.start(queue: queue)
        self.listener = listener

        if ready.wait(timeout: .now() + 2) == .timedOut {
            throw ServerError.message("Local site server timed out while starting.")
        }
        if let startupError {
            throw startupError
        }
        guard let port = listener.port?.rawValue else {
            throw ServerError.message("Local site server did not get a port.")
        }

        return URL(string: "http://127.0.0.1:\(port)/index.html")!
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, _, _ in
            guard let self else { return }
            guard
                let data,
                let request = String(data: data, encoding: .utf8),
                let firstLine = request.components(separatedBy: "\r\n").first
            else {
                self.send(status: "400 Bad Request", body: Data("Bad Request".utf8), mime: "text/plain", on: connection)
                return
            }

            let parts = firstLine.split(separator: " ")
            guard parts.count >= 2 else {
                self.send(status: "400 Bad Request", body: Data("Bad Request".utf8), mime: "text/plain", on: connection)
                return
            }

            let method = String(parts[0])
            guard method == "GET" || method == "HEAD" else {
                self.send(status: "405 Method Not Allowed", body: Data("Method Not Allowed".utf8), mime: "text/plain", on: connection)
                return
            }

            let rawPath = String(parts[1])
            let path = self.normalizedPath(rawPath)
            self.fetchLive(path: path, method: method) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let response):
                    self.send(status: "200 OK", body: response.body, mime: response.mime, on: connection)
                case .failure:
                    self.sendBundled(path: path, method: method, on: connection)
                }
            }
        }
    }

    private func fetchLive(path: String, method: String, completion: @escaping (Result<LiveResponse, Error>) -> Void) {
        let upstreamURL = upstreamBaseURL.appendingPathComponent(path)
        var request = URLRequest(
            url: upstreamURL,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 8
        )
        request.httpMethod = method
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }
            guard
                let http = response as? HTTPURLResponse,
                200..<300 ~= http.statusCode,
                let data
            else {
                completion(.failure(ServerError.message("Live site returned an invalid response.")))
                return
            }
            let mime = http.value(forHTTPHeaderField: "Content-Type") ?? self.mimeType(forPath: path)
            completion(.success(LiveResponse(body: method == "HEAD" ? Data() : data, mime: mime)))
        }.resume()
    }

    private func sendBundled(path: String, method: String, on connection: NWConnection) {
        let fileURL = siteRoot.appendingPathComponent(path)
        guard isInsideSiteRoot(fileURL), FileManager.default.fileExists(atPath: fileURL.path) else {
            send(status: "404 Not Found", body: Data("Not Found".utf8), mime: "text/plain", on: connection)
            return
        }

        do {
            let body = method == "HEAD" ? Data() : try Data(contentsOf: fileURL)
            send(status: "200 OK", body: body, mime: mimeType(for: fileURL), on: connection)
        } catch {
            send(status: "500 Internal Server Error", body: Data(error.localizedDescription.utf8), mime: "text/plain", on: connection)
        }
    }

    private func send(status: String, body: Data, mime: String, on connection: NWConnection) {
        let header = [
            "HTTP/1.1 \(status)",
            "Content-Length: \(body.count)",
            "Content-Type: \(mime)",
            "Cache-Control: no-store",
            "Access-Control-Allow-Origin: *",
            "Connection: close",
            "",
            ""
        ].joined(separator: "\r\n")
        var response = Data(header.utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func normalizedPath(_ rawPath: String) -> String {
        let withoutQuery = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? "/"
        let decoded = withoutQuery.removingPercentEncoding ?? withoutQuery
        let trimmed = decoded.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return trimmed.isEmpty ? "index.html" : trimmed
    }

    private func isInsideSiteRoot(_ url: URL) -> Bool {
        let rootPath = siteRoot.standardizedFileURL.path
        let filePath = url.standardizedFileURL.path
        return filePath == rootPath || filePath.hasPrefix(rootPath + "/")
    }

    private func mimeType(for url: URL) -> String {
        mimeType(forPath: url.path)
    }

    private func mimeType(forPath path: String) -> String {
        switch URL(fileURLWithPath: path).pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "webp": return "image/webp"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }

    struct LiveResponse {
        let body: Data
        let mime: String
    }

    enum ServerError: LocalizedError {
        case message(String)

        var errorDescription: String? {
            switch self {
            case .message(let message): return message
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: BrowserWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()

        let controller = BrowserWindowController()
        windowController = controller
        controller.present()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            windowController?.present()
        }
        return true
    }

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "About Affinity Hub",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit Affinity Hub",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(BrowserWindowController.reloadPage), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "Back", action: #selector(BrowserWindowController.goBack), keyEquivalent: "[")
        viewMenu.addItem(withTitle: "Forward", action: #selector(BrowserWindowController.goForward), keyEquivalent: "]")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "Open Website in Browser", action: #selector(BrowserWindowController.openWebsite), keyEquivalent: "")
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        NSApp.mainMenu = mainMenu
    }
}

@main
enum AffinityHubApp {
    private static let delegate = AppDelegate()

    static func main() {
        let app = NSApplication.shared
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

final class BrowserWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate {
    private let webView: WKWebView
    private var localServer: LocalSiteServer?

    init() {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.websiteDataStore = .nonPersistent()

        webView = WKWebView(frame: .zero, configuration: configuration)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Affinity Hub"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 920, height: 620)

        super.init(window: window)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }

        window.contentView = makeContentView()
        loadAffinityHub()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @objc func reloadPage() {
        webView.reloadFromOrigin()
    }

    @objc func goBack() {
        if webView.canGoBack {
            webView.goBack()
        }
    }

    @objc func goForward() {
        if webView.canGoForward {
            webView.goForward()
        }
    }

    @objc func openWebsite() {
        NSWorkspace.shared.open(liveSiteURL)
    }

    func present() {
        guard let window else { return }
        window.center()
        window.deminiaturize(nil)
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
        NSRunningApplication.current.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    }

    private func makeContentView() -> NSView {
        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(calibratedRed: 0.008, green: 0.024, blue: 0.09, alpha: 1).cgColor

        webView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: root.topAnchor),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])

        return root
    }

    private func loadAffinityHub() {
        guard
            let siteRoot = Bundle.main.resourceURL?.appendingPathComponent(bundledSiteDirectory, isDirectory: true),
            FileManager.default.fileExists(atPath: siteRoot.appendingPathComponent("index.html").path)
        else {
            showFallbackPage("Bundled site files were not found.")
            return
        }

        do {
            let server = LocalSiteServer(siteRoot: siteRoot, upstreamBaseURL: liveSiteURL)
            let url = try server.start()
            localServer = server
            webView.load(noCacheRequest(for: url))
        } catch {
            showFallbackPage("The local site server could not start: \(error.localizedDescription)")
        }
    }

    private func noCacheRequest(for url: URL) -> URLRequest {
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30
        )
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        return request
    }

    private func showFallbackPage(_ message: String) {
        let html = """
        <!doctype html>
        <html>
        <head>
        <meta charset="utf-8">
        <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #020617;
          color: #f8fafc;
          font: 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        main {
          width: min(680px, calc(100vw - 48px));
          padding: 28px;
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 24px;
          background: rgba(255,255,255,.08);
        }
        h1 { margin: 0 0 10px; font-size: 36px; line-height: 1; }
        p { color: #cbd5e1; line-height: 1.5; }
        </style>
        </head>
        <body><main><h1>Affinity Hub</h1><p>\(escapeHTML(message))</p></main></body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        window?.title = "Affinity Hub"
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        showFallbackPage(error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        showFallbackPage(error.localizedDescription)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if navigationAction.targetFrame == nil, shouldOpenExternally(url) {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.javaScript, .plainText, .sourceCode]

        guard let window else {
            completionHandler(nil)
            return
        }

        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    private func shouldOpenExternally(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "file" { return false }

        let host = url.host?.lowercased() ?? ""
        if host == "localhost" || host == "::1" || host == "127.0.0.1" {
            return false
        }

        return url.absoluteString.contains("github.com")
            || url.absoluteString.contains("buymeacoffee.com")
    }
}
