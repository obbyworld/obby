import BackgroundTasks
import Foundation
import Tauri
import UIKit
import UserNotifications
import WebKit

private let backgroundTaskId = "world.obby.background-check"
private let configKey = "obby.backgroundCheck.config"
private let stateKey = "obby.backgroundCheck.state"
private let intervalKey = "obby.backgroundCheck.interval"

@_silgen_name("obby_background_check")
private func obby_background_check(
  _ config: UnsafePointer<CChar>, _ state: UnsafePointer<CChar>, _ now: Int64
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("obby_background_free")
private func obby_background_free(_ value: UnsafeMutablePointer<CChar>?)

/// Registers the refresh task before the app finishes launching, which is the
/// only time iOS accepts it.
@_cdecl("obby_register_background_check")
public func obbyRegisterBackgroundCheck() {
  BGTaskScheduler.shared.register(forTaskWithIdentifier: backgroundTaskId, using: nil) { task in
    guard let refresh = task as? BGAppRefreshTask else {
      task.setTaskCompleted(success: false)
      return
    }
    BackgroundCheck.run(refresh)
  }
  NotificationCenter.default.addObserver(
    forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
  ) { _ in BackgroundCheck.schedule() }
}

enum BackgroundCheck {
  static func schedule() {
    guard UserDefaults.standard.string(forKey: configKey) != nil else { return }
    let minutes = max(UserDefaults.standard.integer(forKey: intervalKey), 15)
    let request = BGAppRefreshTaskRequest(identifier: backgroundTaskId)
    request.earliestBeginDate = Date(timeIntervalSinceNow: TimeInterval(minutes * 60))
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      NSLog("ObbyBackground: could not schedule the check: %@", error.localizedDescription)
    }
  }

  static func run(_ task: BGAppRefreshTask) {
    schedule()
    let work = DispatchWorkItem { check() }
    task.expirationHandler = { work.cancel() }
    work.notify(queue: .global()) { task.setTaskCompleted(success: !work.isCancelled) }
    DispatchQueue.global(qos: .utility).async(execute: work)
  }

  static func check() {
    guard let config = UserDefaults.standard.string(forKey: configKey) else { return }
    let state = UserDefaults.standard.string(forKey: stateKey) ?? "{}"
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    guard let raw = obby_background_check(config, state, now) else { return }
    let outcome = String(cString: raw)
    obby_background_free(raw)
    guard
      let data = outcome.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    for error in json["errors"] as? [String] ?? [] {
      NSLog("ObbyBackground: %@", error)
    }
    if let newState = json["state"],
      let stateData = try? JSONSerialization.data(withJSONObject: newState)
    {
      UserDefaults.standard.set(String(data: stateData, encoding: .utf8), forKey: stateKey)
    }
    for notice in json["notices"] as? [[String: Any]] ?? [] {
      post(notice)
    }
  }

  private static func post(_ notice: [String: Any]) {
    let content = UNMutableNotificationContent()
    content.title = notice["title"] as? String ?? ""
    content.body = notice["body"] as? String ?? ""
    content.sound = .default
    content.threadIdentifier = notice["group"] as? String ?? ""
    // The notification plugin keeps a notification's extra data under this key.
    content.userInfo = ["__EXTRA__": notice["extra"] ?? [:]]
    let id = String(notice["id"] as? Int ?? 0)
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: id, content: content, trigger: nil))
  }
}

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

class ConfigureArgs: Decodable {
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

  @objc public func configure(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ConfigureArgs.self)
    UserDefaults.standard.set(args.config, forKey: configKey)
    UserDefaults.standard.set(args.intervalMinutes, forKey: intervalKey)
    if args.config == nil {
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: backgroundTaskId)
    }
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
      previous.userNotificationCenter?(
        center, willPresent: notification, withCompletionHandler: completionHandler)
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
