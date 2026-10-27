import Cocoa
import WebKit
import ApplicationServices

private func titleWhalePath(in side: CGFloat) -> NSBezierPath {
  let s = side / 18
  func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x * s, y: y * s) }
  let whale = NSBezierPath()
  whale.move(to: p(1.15, 4.7))
  whale.curve(to: p(3.15, 3.35), controlPoint1: p(1.15, 3.7), controlPoint2: p(2.05, 3.35))
  whale.curve(to: p(4.85, 4.55), controlPoint1: p(4.15, 3.35), controlPoint2: p(4.85, 3.85))
  whale.curve(to: p(3.55, 6.15), controlPoint1: p(4.85, 5.35), controlPoint2: p(4.25, 6.05))
  whale.curve(to: p(6.55, 3.7), controlPoint1: p(4.15, 5.15), controlPoint2: p(5.15, 3.85))
  whale.curve(to: p(8.85, 4.85), controlPoint1: p(7.75, 3.55), controlPoint2: p(8.75, 4.05))
  whale.curve(to: p(7.35, 6.45), controlPoint1: p(8.95, 5.65), controlPoint2: p(8.25, 6.35))
  whale.curve(to: p(12.4, 4.55), controlPoint1: p(8.4, 5.35), controlPoint2: p(10.2, 4.15))
  whale.curve(to: p(15.55, 3.85), controlPoint1: p(13.5, 4.15), controlPoint2: p(14.55, 3.55))
  whale.curve(to: p(16.75, 7.4), controlPoint1: p(16.7, 4.2), controlPoint2: p(17.05, 5.7))
  whale.curve(to: p(15.35, 11.35), controlPoint1: p(16.5, 8.9), controlPoint2: p(16.05, 10.3))
  whale.curve(to: p(11.7, 14.15), controlPoint1: p(14.5, 12.6), controlPoint2: p(13.2, 13.7))
  whale.curve(to: p(8.15, 15.05), controlPoint1: p(10.4, 14.55), controlPoint2: p(9.2, 15.15))
  whale.curve(to: p(5.35, 12.55), controlPoint1: p(6.9, 14.95), controlPoint2: p(5.85, 13.9))
  whale.curve(to: p(3.55, 8.9), controlPoint1: p(4.7, 11.2), controlPoint2: p(3.95, 10.05))
  whale.curve(to: p(1.15, 4.7), controlPoint1: p(2.9, 7.2), controlPoint2: p(1.55, 5.7))
  whale.close()
  func slot(_ a: NSPoint, _ c1: NSPoint, _ c2: NSPoint, _ b: NSPoint) {
    let g = NSBezierPath()
    g.move(to: a)
    g.curve(to: b, controlPoint1: c1, controlPoint2: c2)
    g.curve(to: a, controlPoint1: NSPoint(x: c2.x, y: c2.y + 0.42 * s), controlPoint2: NSPoint(x: c1.x, y: c1.y + 0.42 * s))
    g.close()
    whale.append(g)
  }
  slot(p(11.3, 8.7), p(13.2, 9.5), p(14.6, 10.5), p(15.5, 11.35))
  slot(p(10.7, 10.15), p(12.6, 11.0), p(13.9, 12.0), p(14.7, 12.85))
  whale.appendOval(in: NSRect(x: 14.15 * s, y: 6.15 * s, width: 1.05 * s, height: 1.05 * s))
  for c in [p(5.55, 9.55), p(6.55, 10.55), p(7.45, 9.45), p(8.35, 10.35)] {
    whale.appendOval(in: NSRect(x: c.x, y: c.y, width: 0.72 * s, height: 0.72 * s))
  }
  whale.windingRule = .evenOdd
  return whale
}

@main
struct QuotaPotMain {
  static func main() {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    app.run()
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSWindowDelegate {
  private var window: NSWindow?
  private var webView: WKWebView?
  private var statusItem: NSStatusItem?
  private var backend: Process?
  private var port = 18765
  private var pollTimer: Timer?
  private let compactSize = NSSize(width: 400, height: 680)
  private let expandedSize = NSSize(width: 860, height: 680)

  func applicationDidFinishLaunching(_ notification: Notification) {
    startBackendIfNeeded()
    NSApp.applicationIconImage = NSWorkspace.shared.icon(forFile: Bundle.main.bundleURL.path)
    makeStatusItem()
    showWindow()
    pollTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
      self?.refreshMenuTitle()
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
      self?.refreshMenuTitle()
    }
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    showWindow()
    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    backend?.terminate()
  }

  @objc private func toggleWindow() {
    if let window, window.isVisible {
      window.orderOut(nil)
    } else {
      showWindow()
    }
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }

  private func menuIcon() -> NSImage {
    let side: CGFloat = 18
    let image = NSImage(size: NSSize(width: side, height: side), flipped: true) { _ in
      NSColor.white.setFill()
      titleWhalePath(in: side).fill()
      return true
    }
    image.isTemplate = false
    return image
  }

  private func makeStatusItem() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    item.button?.image = menuIcon()
    item.button?.imagePosition = .imageOnly
    item.button?.toolTip = "QuotaPot"
    let menu = NSMenu()
    menu.addItem(withTitle: "显示窗口", action: #selector(toggleWindow), keyEquivalent: "")
    menu.addItem(withTitle: "退出", action: #selector(quit), keyEquivalent: "q")
    item.menu = menu
    statusItem = item
  }

  private func showWindow() {
    if window == nil {
      let config = WKWebViewConfiguration()
      config.userContentController.add(self, name: "quotapot")
      let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 380, height: 640), configuration: config)
      view.navigationDelegate = self
      webView = view
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 380, height: 640),
        styleMask: [.titled, .closable, .miniaturizable, .resizable],
        backing: .buffered,
        defer: false
      )
      window.title = ""
      window.titleVisibility = .hidden
      window.titlebarAppearsTransparent = true
      window.backgroundColor = NSColor(calibratedRed: 0.933, green: 0.945, blue: 0.973, alpha: 1)
      window.minSize = NSSize(width: 360, height: 480)
      window.delegate = self
      window.contentView = view
      let screen = window.screen ?? NSScreen.main
      let vis = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
      if let saved = savedFrame() {
        window.setFrame(saved, display: true)
      } else {
        let size = compactSize
        window.setFrame(NSRect(x: vis.minX + 80, y: vis.maxY - size.height - 48, width: size.width, height: size.height), display: true)
      }
      window.isReleasedWhenClosed = false
      self.window = window
      loadDashboard()
    }
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
      guard let main = self?.window else { return }
      // ponytail: macOS 26 adds a 500×500 TUINSWindow at the origin; hide it so it does not cover the desktop
      for candidate in NSApp.windows where candidate !== main && candidate.className == "TUINSWindow" {
        candidate.alphaValue = 0
        candidate.orderOut(nil)
      }
    }
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any] else { return }
    if body["action"] as? String == "focusChat" {
      DispatchQueue.main.async { self.focusCursorChat() }
      return
    }
    if body["action"] as? String == "badge" {
      let count = Int(self.number(body["count"]))
      DispatchQueue.main.async {
        NSApp.dockTile.badgeLabel = count > 0 ? (count > 99 ? "99+" : String(count)) : nil
      }
      return
    }
    guard let mode = body["mode"] as? String else { return }
    DispatchQueue.main.async { self.applyMode(mode) }
  }

  private var accessibilityPrompted = false

  private func accessibilityTrusted() -> Bool {
    if AXIsProcessTrusted() { return true }
    // ponytail: the system dialog repeats on every call while this process is still untrusted. Ask once per launch.
    if accessibilityPrompted { return false }
    accessibilityPrompted = true
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    return AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
  }

  private func focusCursorChat() {
    guard accessibilityTrusted() else { return }
    let cursor = NSRunningApplication.runningApplications(withBundleIdentifier: "com.todesktop.230313mzl4w4u92").first
    cursor?.activate(options: [.activateAllWindows])
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
      let source = CGEventSource(stateID: .hidSystemState)
      let flags: CGEventFlags = [.maskCommand, .maskShift, .maskAlternate, .maskControl]
      let down = CGEvent(keyboardEventSource: source, virtualKey: 12, keyDown: true)
      let up = CGEvent(keyboardEventSource: source, virtualKey: 12, keyDown: false)
      down?.flags = flags
      up?.flags = flags
      down?.post(tap: .cghidEventTap)
      up?.post(tap: .cghidEventTap)
    }
  }

  func windowDidEndLiveResize(_ notification: Notification) {
    rememberFrame()
  }

  private func applyMode(_ mode: String) {
    guard let window else { return }
    let size = mode == "expanded" ? expandedSize : compactSize
    var frame = window.frame
    let vis = window.screen?.visibleFrame ?? frame
    frame.origin.y += frame.height - size.height
    frame.size = size
    if frame.maxX > vis.maxX { frame.origin.x = vis.maxX - frame.width }
    if frame.minX < vis.minX { frame.origin.x = vis.minX }
    if frame.minY < vis.minY { frame.origin.y = vis.minY }
    if frame.maxY > vis.maxY { frame.origin.y = vis.maxY - frame.height }
    window.setFrame(frame, display: true, animate: true)
    rememberFrame()
  }

  private func savedFrame() -> NSRect? {
    guard let raw = UserDefaults.standard.string(forKey: "quotapot.windowFrame") else { return nil }
    let parts = raw.split(separator: ",").compactMap { Double($0) }
    guard parts.count == 4, parts[2] >= 360, parts[3] >= 480 else { return nil }
    return NSRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
  }

  private func rememberFrame() {
    guard let frame = window?.frame else { return }
    let raw = [frame.origin.x, frame.origin.y, frame.size.width, frame.size.height]
      .map { String(format: "%.0f", $0) }
      .joined(separator: ",")
    UserDefaults.standard.set(raw, forKey: "quotapot.windowFrame")
  }

  private func loadDashboard() {
    guard let url = URL(string: "http://127.0.0.1:\(port)/") else { return }
    webView?.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15))
  }

  private func resourceText(_ name: String) -> String? {
    Bundle.main.url(forResource: name, withExtension: "txt", subdirectory: nil)
      .flatMap { try? String(contentsOf: $0, encoding: .utf8) }?
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func startBackendIfNeeded() {
    if urlAlive() { return }
    guard let root = resourceText("plugin-root"), let node = resourceText("node-path") else {
      statusItem?.button?.title = "QP ?"
      return
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: node)
    process.arguments = [root + "/desktop.mjs", "--serve"]
    process.currentDirectoryURL = URL(fileURLWithPath: root)
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError
    do {
      try process.run()
    } catch {
      statusItem?.button?.title = "QP !"
      return
    }
    backend = process
    for _ in 0..<50 where !urlAlive() {
      Thread.sleep(forTimeInterval: 0.1)
    }
  }

  private func urlAlive() -> Bool {
    var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!)
    request.timeoutInterval = 0.4
    let semaphore = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: request) { _, response, _ in
      ok = ((response as? HTTPURLResponse)?.statusCode ?? 0) == 200
      semaphore.signal()
    }.resume()
    _ = semaphore.wait(timeout: .now() + 0.5)
    return ok
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if let url = navigationAction.request.url, url.scheme == "https" {
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  private func number(_ value: Any?) -> Double {
    if let number = value as? NSNumber { return number.doubleValue }
    if let number = value as? Double { return number }
    if let number = value as? Int { return Double(number) }
    return 0
  }

  private func refreshMenuTitle() {
    guard let url = URL(string: "http://127.0.0.1:\(port)/api/status") else { return }
    URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard let self, let data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { return }
      let cursor = json["cursor"] as? [String: Any]
      let codex = json["codex"] as? [String: Any]
      let cursorText: String
      if let cursor, cursor["ok"] as? Bool == true {
        cursorText = "C \(Int(self.number(cursor["usedPercent"]).rounded()))%"
      } else {
        cursorText = "C !"
      }
      let codexText: String
      if let codex, codex["ok"] as? Bool == true, let limit = codex["limit"] as? [String: Any],
         let primary = limit["primary"] as? [String: Any]
      {
        codexText = "X \(Int(self.number(primary["usedPercent"]).rounded()))%"
      } else if let codex, codex["ok"] as? Bool == true {
        codexText = "X"
      } else {
        codexText = "X !"
      }
      DispatchQueue.main.async {
        self.statusItem?.button?.image = self.menuIcon()
        self.statusItem?.button?.title = ""
        self.statusItem?.button?.toolTip = "QuotaPot  \(cursorText)  \(codexText)"
        self.window?.title = ""
      }
    }.resume()
  }
}
