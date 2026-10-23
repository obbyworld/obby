import Foundation
import Tauri
import UIKit
import UserNotifications
import WebKit

/// The chat a notification points at, as the web app routes it.
struct NoticeTarget: Codable {
  let serverId: String
  let target: String
  let time: Double
  let msgid: String?

  init?(_ extra: [String: Any]) {
    guard let serverId = extra["serverId"] as? String,
      let target = extra["target"] as? String,
      let time = (extra["time"] as? NSNumber)?.doubleValue
        ?? (extra["time"] as? String).flatMap(Double.init)
    else { return nil }
    self.serverId = serverId
    self.target = target
    self.time = time
    self.msgid = extra["msgid"] as? String
  }
}

struct LaunchTarget: Encodable {
  let target: NoticeTarget?
}

class ConfigureHistoryPollArgs: Decodable {
  let config: String?
  let intervalMinutes: Int
}

// We handle taps here because the notification plugin only knows notifications from the running process.
class MobileNotificationsPlugin: Plugin, UNUserNotificationCenterDelegate {
  private var launchTarget: NoticeTarget?
  private weak var previousDelegate: UNUserNotificationCenterDelegate?

  override init() {
    super.init()
    previousDelegate = UNUserNotificationCenter.current().delegate
    UNUserNotificationCenter.current().delegate = self
  }

  @objc public func configureHistoryPoll(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ConfigureHistoryPollArgs.self)
    HistoryPoll.configure(config: args.config, intervalMinutes: args.intervalMinutes)
    invoke.resolve()
  }

  @objc public func takeLaunchTarget(_ invoke: Invoke) throws {
    let target = launchTarget
    launchTarget = nil
    invoke.resolve(LaunchTarget(target: target))
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if let previous = previousDelegate,
      previous.responds(
        to: #selector(
          UNUserNotificationCenterDelegate.userNotificationCenter(
            _:willPresent:withCompletionHandler:)))
    {
      // The notification plugin answers with the deprecated .alert, which iOS 26 no longer shows as a banner, so we ask for one.
      previous.userNotificationCenter?(center, willPresent: notification) { options in
        completionHandler(
          options.contains(.alert) ? options.subtracting(.alert).union([.banner, .list]) : options)
      }
      return
    }
    completionHandler([.banner, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    defer { completionHandler() }
    guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
      let extra = response.notification.request.content.userInfo["__EXTRA__"]
        as? [String: Any],
      let target = NoticeTarget(extra)
    else { return }
    launchTarget = target
    try? trigger("notificationTapped", data: target)
  }
}

@_cdecl("init_plugin_mobile_notifications")
func initPlugin() -> Plugin {
  return MobileNotificationsPlugin()
}
