import Tauri
import UIKit
import WebKit

class KeyboardPlugin: Plugin {
  private var keyboardObserver: KeyboardObserver?

  override public func load(webview: WKWebView) {
    super.load(webview: webview)

    keyboardObserver = KeyboardObserver(webview: webview) { [weak self] event in
      self?.sendKeyboardEvent(event)
    }

    keyboardObserver?.startObserving()
  }

  deinit {
    keyboardObserver?.stopObserving()
  }

  private func sendKeyboardEvent(_ event: KeyboardEvent) {
    let data: JSObject = [
      "eventType": event.eventType,
      "keyboardHeight": event.keyboardHeight,
      "animationDuration": event.animationDuration,
    ]
    self.trigger("plugin:keyboard::ios-keyboard-event", data: data)
  }
}

struct KeyboardEvent {
  let eventType: String
  let keyboardHeight: Double
  let animationDuration: Double
}

class KeyboardObserver {
  private var onKeyboardEvent: ((KeyboardEvent) -> Void)?
  private weak var webview: WKWebView?

  init(webview: WKWebView, onEvent: @escaping (KeyboardEvent) -> Void) {
    self.webview = webview
    self.onKeyboardEvent = onEvent
  }

  func startObserving() {
    let nc = NotificationCenter.default
    nc.addObserver(
      self, selector: #selector(keyboardWillShow), name: UIResponder.keyboardWillShowNotification,
      object: nil)
    nc.addObserver(
      self, selector: #selector(keyboardDidShow), name: UIResponder.keyboardDidShowNotification,
      object: nil)
    nc.addObserver(
      self, selector: #selector(keyboardWillHide), name: UIResponder.keyboardWillHideNotification,
      object: nil)
    nc.addObserver(
      self, selector: #selector(keyboardDidHide), name: UIResponder.keyboardDidHideNotification,
      object: nil)
  }

  func stopObserving() {
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func keyboardWillShow(notification: NSNotification) {
    guard let userInfo = notification.userInfo,
      let keyboardFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
      let animationDuration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double
    else {
      return
    }

    onKeyboardEvent?(
      KeyboardEvent(
        eventType: "will-show",
        keyboardHeight: keyboardFrame.height,
        animationDuration: animationDuration
      ))
  }

  @objc private func keyboardDidShow(notification: NSNotification) {
    guard let userInfo = notification.userInfo,
      let keyboardFrame = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
      let animationDuration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double
    else {
      return
    }

    // Lock the root scroll view AFTER WKWebView has finished its keyboard adjustment.
    // This prevents the user from scrolling the whole frame while keeping the input
    // correctly positioned above the keyboard.
    // CSS overflow:auto containers (message list) use their own composited scroll layers
    // and are unaffected by the root scrollView.isScrollEnabled.
    webview?.scrollView.isScrollEnabled = false

    onKeyboardEvent?(
      KeyboardEvent(
        eventType: "did-show",
        keyboardHeight: keyboardFrame.height,
        animationDuration: animationDuration
      ))
  }

  @objc private func keyboardWillHide(notification: NSNotification) {
    guard let userInfo = notification.userInfo,
      let animationDuration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double
    else {
      return
    }

    // Re-enable scrolling before WKWebView resets its viewport for keyboard hide.
    webview?.scrollView.isScrollEnabled = true

    onKeyboardEvent?(
      KeyboardEvent(
        eventType: "will-hide",
        keyboardHeight: 0,
        animationDuration: animationDuration
      ))
  }

  @objc private func keyboardDidHide(notification: NSNotification) {
    guard let userInfo = notification.userInfo,
      let animationDuration = userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double
    else {
      return
    }

    onKeyboardEvent?(
      KeyboardEvent(
        eventType: "did-hide",
        keyboardHeight: 0,
        animationDuration: animationDuration
      ))
  }
}

@_cdecl("init_plugin_keyboard")
func initPlugin() -> Plugin {
  return KeyboardPlugin()
}
