//
//  ManualQARemoteControl.swift
//  iosAppUITests
//
//  XCUITest "remote control" for the manual-qa-runner. The runner's
//  iOS driver writes a JSON command file to a known path; this test
//  reads it, executes each command via XCUIApplication, and writes
//  results back to a second JSON file. The runner polls the result
//  file via `xcrun simctl get_app_container` + a file watcher.
//
//  Command schema (one per line, JSON-lines):
//    {"op": "tap", "id": "<accessibility-identifier>"}
//    {"op": "tap_text", "text": "<exact visible text>"}
//    {"op": "type", "id": "<field id>", "text": "<value>"}
//    {"op": "swipe", "direction": "up|down|left|right", "id": "<from id>"}
//    {"op": "dump", "id": "ui"}        // returns accessibility hierarchy
//    {"op": "wait", "id": "<id>", "timeoutMs": 5000}
//
//  Result schema (one per command):
//    {"ok": true,  "data": "<optional payload>"}
//    {"ok": false, "error": "<reason>"}
//
//  This test stays running until it receives an {"op": "shutdown"}
//  command. Designed to be invoked via:
//    xcodebuild test-without-building \
//      -workspace iosApp.xcworkspace \
//      -scheme iosAppUITests \
//      -destination "platform=iOS Simulator,id=<UDID>"
//
//  The simulator's documents directory is the shared filesystem the
//  runner reads/writes through. Path:
//    ~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Containers/Shared/AppGroup/.../qa-cmd.jsonl
//    (a more practical fallback is /tmp inside the simulator, since
//     xcrun simctl can `push` files there).
//
//  Pre-requisite for the runner: the iOS app must be built with
//  accessibilityIdentifier set on every Compose node that scenarios
//  reference. Currently the Compose root has `testTagsAsResourceId`
//  applied for Android (see W113); the iOS equivalent uses
//  `Modifier.semantics { accessibilityIdentifier = "..." }` which the
//  app must also wire up.

import XCTest

final class ManualQARemoteControl: XCTestCase {
    // Path the runner writes commands to. The runner pushes the file
    // into the simulator via `xcrun simctl push` before each command;
    // this test polls for changes.
    private static let commandPath = "/tmp/qa-cmd.jsonl"
    private static let resultPath = "/tmp/qa-result.jsonl"
    private static let pollIntervalMs: UInt32 = 100
    private static let idleTimeoutSeconds: TimeInterval = 600 // shutdown after 10min idle

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testRemoteControl() throws {
        let app = XCUIApplication()
        app.launch()
        var lastCommandTime = Date()
        while Date().timeIntervalSince(lastCommandTime) < Self.idleTimeoutSeconds {
            guard let cmdJson = readNextCommand() else {
                usleep(Self.pollIntervalMs * 1000)
                continue
            }
            lastCommandTime = Date()
            guard let op = cmdJson["op"] as? String else {
                writeResult(["ok": false, "error": "missing op"])
                continue
            }
            if op == "shutdown" {
                writeResult(["ok": true])
                return
            }
            do {
                let result = try execute(op: op, args: cmdJson, app: app)
                writeResult(["ok": true, "data": result])
            } catch {
                writeResult(["ok": false, "error": String(describing: error)])
            }
        }
    }

    // MARK: - Command execution

    private func execute(op: String, args: [String: Any], app: XCUIApplication) throws -> Any {
        switch op {
        case "tap":
            let id = (args["id"] as? String) ?? ""
            let el = app.descendants(matching: .any)
                .matching(identifier: id)
                .firstMatch
            guard el.waitForExistence(timeout: 5) else {
                throw NSError(domain: "QA", code: 1, userInfo: [NSLocalizedDescriptionKey: "element \"\(id)\" not found"])
            }
            el.tap()
            return id
        case "tap_text":
            let text = (args["text"] as? String) ?? ""
            let el = app.staticTexts[text]
            guard el.waitForExistence(timeout: 5) else {
                throw NSError(domain: "QA", code: 2, userInfo: [NSLocalizedDescriptionKey: "text \"\(text)\" not found"])
            }
            el.tap()
            return text
        case "type":
            let id = (args["id"] as? String) ?? ""
            let text = (args["text"] as? String) ?? ""
            let el = app.textFields[id].exists ? app.textFields[id] : app.secureTextFields[id]
            guard el.waitForExistence(timeout: 5) else {
                throw NSError(domain: "QA", code: 3, userInfo: [NSLocalizedDescriptionKey: "field \"\(id)\" not found"])
            }
            el.tap()
            el.typeText(text)
            return text
        case "dump":
            return app.debugDescription
        case "wait":
            let id = (args["id"] as? String) ?? ""
            let timeoutMs = (args["timeoutMs"] as? Int) ?? 5000
            let el = app.descendants(matching: .any).matching(identifier: id).firstMatch
            let ok = el.waitForExistence(timeout: TimeInterval(timeoutMs) / 1000.0)
            return ok ? "found" : "not_found"
        case "shows_text":
            // Verify a text string is currently visible somewhere in
            // the hierarchy. Returns "true" or "false" — caller
            // assertion lives on the runner side.
            let text = (args["text"] as? String) ?? ""
            let predicate = NSPredicate(format: "label CONTAINS[c] %@", text)
            let any = app.descendants(matching: .any)
                .containing(predicate)
                .firstMatch
            return any.exists ? "true" : "false"
        default:
            throw NSError(domain: "QA", code: 4, userInfo: [NSLocalizedDescriptionKey: "unknown op \"\(op)\""])
        }
    }

    // MARK: - IPC

    private func readNextCommand() -> [String: Any]? {
        guard FileManager.default.fileExists(atPath: Self.commandPath) else { return nil }
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: Self.commandPath)) else { return nil }
        guard !data.isEmpty else { return nil }
        // One command per file invocation — runner overwrites between
        // sends. Atomicity is the runner's responsibility (it writes
        // to a .tmp first then renames).
        try? FileManager.default.removeItem(atPath: Self.commandPath)
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func writeResult(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        try? data.write(to: URL(fileURLWithPath: Self.resultPath), options: .atomic)
    }
}
