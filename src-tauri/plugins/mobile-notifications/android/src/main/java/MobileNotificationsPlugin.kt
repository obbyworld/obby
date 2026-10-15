package world.obby.notifications

import android.app.Activity
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class ConfigureArgs {
  var config: String? = null
  var intervalMinutes: Long = 15
}

@TauriPlugin
class MobileNotificationsPlugin(private val activity: Activity) : Plugin(activity) {
  private var launchTarget: JSObject? = null

  override fun load(webView: WebView) {
    super.load(webView)
    launchTarget = BackgroundNotices.tappedTarget(activity.intent)
  }

  override fun onResume() {
    super.onResume()
    AppVisibility.isInForeground = true
  }

  override fun onPause() {
    super.onPause()
    AppVisibility.isInForeground = false
  }

  @Command
  fun configure(invoke: Invoke) {
    val args = invoke.parseArgs(ConfigureArgs::class.java)
    val config = args.config
    BackgroundStore.saveConfig(activity, config)
    if (config == null) {
      BackgroundScheduler.cancel(activity)
    } else {
      BackgroundScheduler.schedule(activity, args.intervalMinutes)
    }
    invoke.resolve()
  }

  @Command
  fun takeLaunchTarget(invoke: Invoke) {
    val result = JSObject()
    result.put("target", launchTarget)
    launchTarget = null
    invoke.resolve(result)
  }
}

// We skip the background check while the app is on screen, since the live connection covers it.
object AppVisibility {
  @Volatile var isInForeground = false
}
