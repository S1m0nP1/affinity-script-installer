import AppKit
import Foundation

let catalogURL = URL(string: "https://affinityhub.js.org/scripts.json")!
let catalogBaseURL = URL(string: "https://affinityhub.js.org/")!
let mcpEndpoints = [
    URL(string: "http://[::1]:6767/sse")!,
    URL(string: "https://localhost:6768/sse")!
]
let protocolVersion = "2025-11-25"

struct ScriptCatalog: Decodable {
    let scripts: [HubScript]
}

struct HubScript: Decodable {
    let id: String
    let title: String
    let description: String
    let path: String
    let author: String?
    let version: String?
}

final class MCPClient {
    private var endpointURL: URL?
    private var streamTask: Task<Void, Never>?
    private var nextID = 1
    private var continuations: [Int: CheckedContinuation<[String: Any], Error>] = [:]

    deinit {
        streamTask?.cancel()
    }

    func connect() async throws -> String {
        disconnect()

        var lastError: Error?
        for endpoint in mcpEndpoints {
            do {
                let serverName = try await connect(to: endpoint)
                return serverName
            } catch {
                lastError = error
            }
        }

        throw lastError ?? AppError.message("Could not reach Affinity MCP.")
    }

    func disconnect() {
        streamTask?.cancel()
        streamTask = nil
        endpointURL = nil
        for continuation in continuations.values {
            continuation.resume(throwing: AppError.message("MCP connection closed."))
        }
        continuations.removeAll()
    }

    func install(title: String, description: String, code: String) async throws {
        _ = try await request(
            method: "tools/call",
            params: [
                "name": "save_script_to_library",
                "arguments": [
                    "title": title,
                    "description": description,
                    "code": code
                ]
            ]
        )
    }

    private func connect(to sseURL: URL) async throws -> String {
        var endpointContinuation: CheckedContinuation<String, Error>?

        streamTask = Task {
            do {
                let (bytes, _) = try await URLSession.shared.bytes(from: sseURL)
                var eventName = ""

                for try await line in bytes.lines {
                    if Task.isCancelled { return }
                    if line.hasPrefix("event:") {
                        eventName = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                    } else if line.hasPrefix("data:") {
                        let payload = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        if eventName == "endpoint" {
                            endpointContinuation?.resume(returning: payload)
                            endpointContinuation = nil
                        } else if eventName == "message" {
                            handleMessage(payload)
                        }
                    }
                }
            } catch {
                endpointContinuation?.resume(throwing: error)
                endpointContinuation = nil
                for continuation in continuations.values {
                    continuation.resume(throwing: error)
                }
                continuations.removeAll()
            }
        }

        let endpointPath = try await withCheckedThrowingContinuation { continuation in
            endpointContinuation = continuation
        }

        endpointURL = URL(string: endpointPath, relativeTo: sseURL)?.absoluteURL

        let initialize = try await request(
            method: "initialize",
            params: [
                "protocolVersion": protocolVersion,
                "capabilities": [:],
                "clientInfo": [
                    "name": "affinityhub-mac-test",
                    "version": "0.1.0"
                ]
            ]
        )
        try await notify(method: "notifications/initialized")

        let result = initialize["result"] as? [String: Any]
        let server = result?["serverInfo"] as? [String: Any]
        return server?["name"] as? String ?? "Affinity"
    }

    private func request(method: String, params: [String: Any] = [:]) async throws -> [String: Any] {
        guard let endpointURL else {
            throw AppError.message("MCP endpoint is not ready.")
        }

        let id = nextID
        nextID += 1

        let payload: [String: Any] = [
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        ]

        let responseTask = Task {
            try await withCheckedThrowingContinuation { continuation in
                continuations[id] = continuation
            }
        }

        try await postJSON(payload, to: endpointURL)
        return try await responseTask.value
    }

    private func notify(method: String, params: [String: Any] = [:]) async throws {
        guard let endpointURL else {
            throw AppError.message("MCP endpoint is not ready.")
        }

        try await postJSON(
            [
                "jsonrpc": "2.0",
                "method": method,
                "params": params
            ],
            to: endpointURL
        )
    }

    private func postJSON(_ payload: [String: Any], to url: URL) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw AppError.message("MCP POST failed.")
        }
    }

    private func handleMessage(_ payload: String) {
        guard
            let data = payload.data(using: .utf8),
            let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let id = message["id"] as? Int,
            let continuation = continuations.removeValue(forKey: id)
        else {
            return
        }

        if let error = message["error"] {
            continuation.resume(throwing: AppError.message(String(describing: error)))
        } else {
            continuation.resume(returning: message)
        }
    }
}

enum AppError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let text): text
        }
    }
}

@MainActor
final class AppController: NSObject, NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate {
    private let mcp = MCPClient()
    private var scripts: [HubScript] = []
    private var selectedCode = ""

    private let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 1060, height: 720),
        styleMask: [.titled, .closable, .resizable, .miniaturizable],
        backing: .buffered,
        defer: false
    )
    private let statusLabel = NSTextField(labelWithString: "Load the catalog, then connect to Affinity.")
    private let tableView = NSTableView()
    private let titleField = NSTextField()
    private let descriptionField = NSTextField()
    private let codeView = NSTextView()
    private let installButton = NSButton(title: "Install Selected", target: nil, action: nil)

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildUI()
        window.center()
        window.makeKeyAndOrderFront(nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func numberOfRows(in tableView: NSTableView) -> Int {
        scripts.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cell = NSTableCellView()
        let label = NSTextField(labelWithString: scripts[row].title)
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -8),
            label.centerYAnchor.constraint(equalTo: cell.centerYAnchor)
        ])
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        let row = tableView.selectedRow
        guard row >= 0, row < scripts.count else { return }
        select(script: scripts[row])
    }

    private func buildUI() {
        window.title = "AffinityHub Mac Test"

        let loadButton = NSButton(title: "Load Catalog", target: self, action: #selector(loadCatalog))
        let connectButton = NSButton(title: "Connect to Affinity", target: self, action: #selector(connectToAffinity))
        installButton.target = self
        installButton.action = #selector(installSelected)
        installButton.isEnabled = false

        let toolbar = NSStackView(views: [loadButton, connectButton, installButton, statusLabel])
        toolbar.orientation = .horizontal
        toolbar.alignment = .centerY
        toolbar.spacing = 10
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.lineBreakMode = .byTruncatingTail

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("scripts"))
        column.title = "Scripts"
        tableView.addTableColumn(column)
        tableView.headerView = nil
        tableView.dataSource = self
        tableView.delegate = self

        let tableScroll = NSScrollView()
        tableScroll.documentView = tableView
        tableScroll.hasVerticalScroller = true
        tableScroll.translatesAutoresizingMaskIntoConstraints = false

        titleField.placeholderString = "Library title"
        descriptionField.placeholderString = "Library description"

        codeView.isEditable = false
        codeView.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        codeView.string = "// Select a script to preview it here."

        let codeScroll = NSScrollView()
        codeScroll.documentView = codeView
        codeScroll.hasVerticalScroller = true
        codeScroll.hasHorizontalScroller = true
        codeScroll.translatesAutoresizingMaskIntoConstraints = false

        let detailStack = NSStackView(views: [titleField, descriptionField, codeScroll])
        detailStack.orientation = .vertical
        detailStack.spacing = 10
        detailStack.translatesAutoresizingMaskIntoConstraints = false

        let split = NSSplitView()
        split.isVertical = true
        split.dividerStyle = .thin
        split.addArrangedSubview(tableScroll)
        split.addArrangedSubview(detailStack)
        split.translatesAutoresizingMaskIntoConstraints = false

        let root = NSView()
        root.addSubview(toolbar)
        root.addSubview(split)
        window.contentView = root

        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
            toolbar.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
            toolbar.topAnchor.constraint(equalTo: root.topAnchor, constant: 14),

            split.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
            split.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
            split.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 14),
            split.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -14),

            tableScroll.widthAnchor.constraint(greaterThanOrEqualToConstant: 280),
            titleField.heightAnchor.constraint(equalToConstant: 30),
            descriptionField.heightAnchor.constraint(equalToConstant: 30)
        ])

        split.setPosition(340, ofDividerAt: 0)
    }

    @objc private func loadCatalog() {
        status("Loading catalog...")
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: catalogURL)
                let catalog = try JSONDecoder().decode(ScriptCatalog.self, from: data)
                scripts = catalog.scripts.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
                tableView.reloadData()
                status("Loaded \(scripts.count) scripts.")
            } catch {
                status("Catalog failed: \(error.localizedDescription)")
            }
        }
    }

    @objc private func connectToAffinity() {
        status("Connecting to Affinity MCP...")
        Task {
            do {
                let serverName = try await mcp.connect()
                status("Connected to \(serverName).")
                installButton.isEnabled = !selectedCode.isEmpty
            } catch {
                status("Connection failed. Open Affinity, enable MCP, then try again. Safari is not involved here.")
            }
        }
    }

    @objc private func installSelected() {
        let title = titleField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, !selectedCode.isEmpty else {
            status("Choose a script first.")
            return
        }

        installButton.isEnabled = false
        status("Installing \(title)...")

        Task {
            do {
                try await mcp.install(
                    title: title,
                    description: descriptionField.stringValue,
                    code: selectedCode
                )
                status("Installed \(title).")
            } catch {
                status("Install failed: \(error.localizedDescription)")
            }
            installButton.isEnabled = !selectedCode.isEmpty
        }
    }

    private func select(script: HubScript) {
        titleField.stringValue = script.title
        descriptionField.stringValue = script.description
        codeView.string = "Loading \(script.path)..."
        selectedCode = ""
        installButton.isEnabled = false

        Task {
            do {
                let sourceURL = URL(string: script.path, relativeTo: catalogBaseURL)!.absoluteURL
                let (data, _) = try await URLSession.shared.data(from: sourceURL)
                selectedCode = String(decoding: data, as: UTF8.self)
                codeView.string = selectedCode
                status("Ready: \(script.title)")
                installButton.isEnabled = true
            } catch {
                codeView.string = "// Could not load \(script.path): \(error.localizedDescription)"
                status("Source load failed.")
            }
        }
    }

    private func status(_ text: String) {
        statusLabel.stringValue = text
    }
}

@main
enum AffinityHubMacTest {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppController()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.activate(ignoringOtherApps: true)
        app.run()
    }
}
