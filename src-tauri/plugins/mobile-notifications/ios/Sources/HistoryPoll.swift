// History poll: the fallback for servers without web push. While the app is in
// the background, iOS runs it now and then and it posts what arrived.
import BackgroundTasks
import Foundation
import UIKit
import UserNotifications

// We keep the id the app first shipped with: iOS drops requests for ids added in an update.
private let taskId = "world.obby.background-check"
private let configKey = "obby.historyPoll.config"
private let stateKey = "obby.historyPoll.state"
private let intervalKey = "obby.historyPoll.interval"

@_silgen_name("obby_history_poll_check")
private func obby_history_poll_check(
  _ config: UnsafePointer<CChar>, _ state: UnsafePointer<CChar>, _ now: Int64
) -> UnsafeMutablePointer<CChar>?

@_silgen_name("obby_history_poll_free")
private func obby_history_poll_free(_ value: UnsafeMutablePointer<CChar>?)

/// Registers the refresh task before the app finishes launching, which is the
/// only time iOS accepts it.
@_cdecl("obby_register_history_poll")
public func obbyRegisterHistoryPoll() {
  BGTaskScheduler.shared.register(forTaskWithIdentifier: taskId, using: nil) { task in
    guard let refresh = task as? BGAppRefreshTask else {
      task.setTaskCompleted(success: false)
      return
    }
    HistoryPoll.run(refresh)
  }
  NotificationCenter.default.addObserver(
    forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
  ) { _ in HistoryPoll.schedule() }
}

enum HistoryPoll {
  static func configure(config: String?, intervalMinutes: Int) {
    UserDefaults.standard.set(config, forKey: configKey)
    UserDefaults.standard.set(intervalMinutes, forKey: intervalKey)
    if config == nil {
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskId)
    }
  }

  static func schedule() {
    guard UserDefaults.standard.string(forKey: configKey) != nil else { return }
    let minutes = max(UserDefaults.standard.integer(forKey: intervalKey), 15)
    let request = BGAppRefreshTaskRequest(identifier: taskId)
    request.earliestBeginDate = Date(timeIntervalSinceNow: TimeInterval(minutes * 60))
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      NSLog("ObbyHistoryPoll: could not schedule the poll: %@", error.localizedDescription)
    }
  }

  static func run(_ task: BGAppRefreshTask) {
    schedule()
    let work = DispatchWorkItem { poll() }
    task.expirationHandler = { work.cancel() }
    work.notify(queue: .global()) { task.setTaskCompleted(success: !work.isCancelled) }
    DispatchQueue.global(qos: .utility).async(execute: work)
  }

  private static func poll() {
    guard let config = UserDefaults.standard.string(forKey: configKey) else { return }
    let state = UserDefaults.standard.string(forKey: stateKey) ?? "{}"
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    guard let raw = obby_history_poll_check(config, state, now) else { return }
    let outcome = String(cString: raw)
    obby_history_poll_free(raw)
    guard
      let data = outcome.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return }
    for error in json["errors"] as? [String] ?? [] {
      NSLog("ObbyHistoryPoll: %@", error)
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
