package world.obby.notifications

import android.app.Activity
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.UnifiedPush

@InvokeArg
class ConfigureHistoryPollArgs {
  var config: String? = null
  var intervalMinutes: Long = 15
}

@InvokeArg
class RegisterPushArgs {
  lateinit var serverId: String
  lateinit var vapidKey: String
  lateinit var mode: String
  lateinit var context: String
  var label: String? = null
}

@InvokeArg
class UnregisterPushArgs {
  lateinit var serverId: String
}

@TauriPlugin
class MobileNotificationsPlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    // The push service reports endpoints here while the app is open.
    @Volatile var current: MobileNotificationsPlugin? = null
  }

  private var launchTarget: JSObject? = null

  override fun load(webView: WebView) {
    super.load(webView)
    launchTarget = ChatNotices.tappedTarget(activity.intent)
    ChatNotices.consumeTap(activity.intent)
    current = this
  }

  @Command
  fun configureHistoryPoll(invoke: Invoke) {
    val args = invoke.parseArgs(ConfigureHistoryPollArgs::class.java)
    val config = args.config
    HistoryPollStore.saveConfig(activity, config)
    if (config == null) {
      HistoryPollScheduler.cancel(activity)
    } else {
      HistoryPollScheduler.schedule(activity, args.intervalMinutes)
    }
    invoke.resolve()
  }

  // The notification plugin leaves the chat out of its tap intent, so we post live notifications too.
  @Command
  fun showNotification(invoke: Invoke) {
    ChatNotices.post(activity, JSONArray().put(invoke.getArgs()))
    invoke.resolve()
  }

  @Command
  fun pushStatus(invoke: Invoke) {
    invoke.resolve(pushStatusResult())
  }

  // The OS lets the user pick among the installed distributors, and remembers
  // the choice for every app that uses UnifiedPush.
  @Command
  fun pickPushDistributor(invoke: Invoke) {
    if (PushDistributors.external(activity).isEmpty()) {
      invoke.resolve(pushStatusResult())
      return
    }
    val before = UnifiedPush.getSavedDistributor(activity)
    UnifiedPush.tryPickDistributor(activity) { isPicked ->
      if (!isPicked || UnifiedPush.getSavedDistributor(activity) == activity.packageName)
        PushDistributors.use(activity, PushMode.UNIFIEDPUSH)
      if (UnifiedPush.getSavedDistributor(activity) != before)
        for (instance in PushStore.instances(activity)) PushStore.register(activity, instance)
      invoke.resolve(pushStatusResult())
    }
  }

  @Command
  fun registerPush(invoke: Invoke) {
    val args = invoke.parseArgs(RegisterPushArgs::class.java)
    val mode = if (args.mode == "unifiedpush") PushMode.UNIFIEDPUSH else PushMode.FCM
    val result = JSObject()
    if (!PushDistributors.use(activity, mode)) {
      result.put("isRegistered", false)
      invoke.resolve(result)
      return
    }
    val registration = JSONObject()
      .put("vapidKey", args.vapidKey)
      .put("label", args.label)
      .put("context", args.context)
    PushStore.save(activity, args.serverId, registration)
    PushStore.register(activity, args.serverId)
    result.put("isRegistered", true)
    invoke.resolve(result)
  }

  @Command
  fun unregisterPush(invoke: Invoke) {
    val args = invoke.parseArgs(UnregisterPushArgs::class.java)
    UnifiedPush.unregister(activity, args.serverId)
    PushStore.save(activity, args.serverId, null)
    invoke.resolve()
  }

  private fun pushStatusResult(): JSObject {
    val distributors = JSArray()
    for (packageName in PushDistributors.external(activity))
      distributors.put(JSObject().put("id", packageName).put("name", PushDistributors.label(activity, packageName)))
    val saved = UnifiedPush.getSavedDistributor(activity)?.takeIf { it != activity.packageName }
    val result = JSObject()
    result.put("isFcmAvailable", PushDistributors.isFcmAvailable(activity))
    result.put("distributors", distributors)
    result.put("current", saved)
    return result
  }

  @Command
  fun takeLaunchTarget(invoke: Invoke) {
    val result = JSObject()
    result.put("target", launchTarget)
    launchTarget = null
    invoke.resolve(result)
  }
}
