import UIKit
import WebKit

/// Tells the page when the app is back in the foreground, so it can restart
/// call videos that iOS paused while the app was away.
class AppLifecycleObserver {
  private weak var webview: WKWebView?

  init(webview: WKWebView) {
    self.webview = webview
    NotificationCenter.default.addObserver(
      self, selector: #selector(didBecomeActive),
      name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func didBecomeActive() {
    webview?.evaluateJavaScript("window.ObbyApp?.didBecomeActive()")
  }
}
