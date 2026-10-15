package world.obby.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import app.tauri.plugin.JSObject
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

// The extras the notification plugin reads from a tap, so taps on what we post
// reach the app the same way as taps on its own notifications.
private const val NOTIFICATION_ID_KEY = "NotificationId"
private const val NOTIFICATION_OBJECT_KEY = "LocalNotficationObject"
private const val ACTION_KEY = "NotificationUserAction"
private const val TAP_ACTION = "tap"
private const val CHANNEL_ID = "messages"

object BackgroundNotices {
  fun post(context: Context, notices: JSONArray) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    ensureChannel(context)
    for (index in 0 until notices.length()) {
      val notice = notices.getJSONObject(index)
      val id = notice.getInt("id")
      val builder = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(notice.optString("title"))
        .setContentText(notice.optString("body"))
        .setStyle(NotificationCompat.BigTextStyle().bigText(notice.optString("body")))
        .setGroup(notice.optString("group"))
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setContentIntent(tapIntent(context, id, notice))
      try {
        manager.notify(id, builder.build())
      } catch (_: SecurityException) {
        return
      }
    }
  }

  private fun tapIntent(context: Context, id: Int, notice: JSONObject): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    intent.action = Intent.ACTION_MAIN
    intent.addCategory(Intent.CATEGORY_LAUNCHER)
    intent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    intent.putExtra(NOTIFICATION_ID_KEY, id)
    intent.putExtra(ACTION_KEY, TAP_ACTION)
    intent.putExtra(NOTIFICATION_OBJECT_KEY, notice.toString())
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(context, id, intent, flags)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH)
    )
  }

  /** The chat a tapped notification points at, from the intent that opened us. */
  fun tappedTarget(intent: Intent?): JSObject? {
    if (intent?.getStringExtra(ACTION_KEY) != TAP_ACTION) return null
    val json = intent.getStringExtra(NOTIFICATION_OBJECT_KEY) ?: return null
    return try {
      val extra = JSONObject(json).optJSONObject("extra") ?: return null
      JSObject(extra.toString())
    } catch (_: JSONException) {
      null
    }
  }
}
