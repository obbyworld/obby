package world.obby.notifications

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
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
// The app creates this channel, with its translated name, before it configures the check.
private const val CHANNEL_ID = "messages"

object ChatNotices {
  fun post(context: Context, notices: JSONArray) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    for (index in 0 until notices.length()) {
      val notice = notices.getJSONObject(index)
      val id = notice.getInt("id")
      val builder = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(smallIcon(context))
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

  // Android draws the small icon as a mask, so we use the app's monochrome notification icon.
  private fun smallIcon(context: Context): Int {
    val id = context.resources.getIdentifier("ic_notification", "drawable", context.packageName)
    return if (id != 0) id else context.applicationInfo.icon
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
