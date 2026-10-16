package world.obby.notifications

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import app.tauri.plugin.JSObject
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

private const val TAG = "ObbyPush"

object PushNative {
  init {
    System.loadLibrary("app_lib")
  }

  @JvmStatic external fun nativeNotice(context: String, line: String, now: Long): String
}

// Each server registers as its own UnifiedPush instance, named by its server id.
// We keep what the registration needs to move to another distributor, and the
// context that words its notifications while the app is closed.
object PushStore {
  private const val PREFERENCES = "obby_push"

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun registration(context: Context, instance: String): JSONObject? =
    preferences(context).getString(instance, null)?.let { JSONObject(it) }

  fun instances(context: Context): Set<String> = preferences(context).all.keys

  fun save(context: Context, instance: String, registration: JSONObject?) {
    preferences(context).edit().putString(instance, registration?.toString()).apply()
  }

  // A new endpoint can come while no page listens, so the page reads it on its next registration.
  fun saveEndpoint(context: Context, instance: String, endpoint: JSONObject?) {
    val registration = registration(context, instance) ?: return
    save(context, instance, registration.put("endpoint", endpoint))
  }

  fun register(context: Context, instance: String) {
    val registration = registration(context, instance) ?: return
    UnifiedPush.register(
      context,
      instance,
      registration.optString("label").ifEmpty { null },
      registration.getString("vapidKey"),
    )
  }
}

enum class PushMode { FCM, UNIFIEDPUSH }

object PushDistributors {
  fun external(context: Context): List<String> =
    UnifiedPush.getDistributors(context).filter { it != context.packageName }

  // The embedded FCM distributor drops out of the list without Play Services.
  fun isFcmAvailable(context: Context): Boolean =
    UnifiedPush.getDistributors(context).contains(context.packageName)

  fun saveDistributorFor(context: Context, mode: PushMode): Boolean {
    val saved = UnifiedPush.getSavedDistributor(context)
    val wanted = when (mode) {
      PushMode.FCM -> context.packageName.takeIf { isFcmAvailable(context) }
      PushMode.UNIFIEDPUSH -> saved?.takeIf { it in external(context) } ?: external(context).firstOrNull()
    } ?: return false
    if (saved != wanted) UnifiedPush.saveDistributor(context, wanted)
    return true
  }

  fun label(context: Context, packageName: String): String =
    try {
      val info = context.packageManager.getApplicationInfo(packageName, 0)
      context.packageManager.getApplicationLabel(info).toString()
    } catch (_: android.content.pm.PackageManager.NameNotFoundException) {
      packageName
    }
}

class ObbyPushService : PushService() {
  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    val keys = endpoint.pubKeySet ?: return
    val saved = JSONObject()
      .put("endpoint", endpoint.url)
      .put("p256dh", keys.pubKey)
      .put("auth", keys.auth)
    PushStore.saveEndpoint(this, instance, saved)
    val event = JSObject(saved.toString())
    event.put("serverId", instance)
    MobileNotificationsPlugin.current?.trigger("pushEndpoint", event)
  }

  override fun onMessage(message: PushMessage, instance: String) {
    if (!message.decrypted || ChatNotices.isAppOnScreen()) return
    val pushContext = PushStore.registration(this, instance)?.optString("context") ?: return
    val line = String(message.content, Charsets.UTF_8)
    val outcome = JSONObject(PushNative.nativeNotice(pushContext, line, System.currentTimeMillis()))
    if (outcome.has("dismiss")) NotificationManagerCompat.from(this).cancel(outcome.getInt("dismiss"))
    ChatNotices.post(this, outcome.optJSONArray("notices") ?: JSONArray())
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    Log.w(TAG, "registration failed for $instance: $reason")
    unregistered(instance, isFailed = true)
  }

  override fun onUnregistered(instance: String) = unregistered(instance, isFailed = false)

  private fun unregistered(instance: String, isFailed: Boolean) {
    PushStore.saveEndpoint(this, instance, null)
    val event = JSObject()
    event.put("serverId", instance)
    event.put("isFailed", isFailed)
    MobileNotificationsPlugin.current?.trigger("pushUnregistered", event)
  }
}
