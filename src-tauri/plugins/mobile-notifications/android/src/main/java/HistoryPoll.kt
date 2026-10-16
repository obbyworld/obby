package world.obby.notifications

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import org.json.JSONObject

object HistoryPollNative {
  init {
    System.loadLibrary("app_lib")
  }

  @JvmStatic external fun nativeCheck(config: String, state: String, now: Long): String
}

object HistoryPollStore {
  private const val PREFERENCES = "obby_history_poll"

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun config(context: Context): String? = preferences(context).getString("config", null)

  fun state(context: Context): String = preferences(context).getString("state", null) ?: "{}"

  fun saveConfig(context: Context, config: String?) {
    preferences(context).edit().putString("config", config).apply()
  }

  fun saveState(context: Context, state: String) {
    preferences(context).edit().putString("state", state).apply()
  }
}

object HistoryPollScheduler {
  private const val PERIODIC = "obby-history-poll"

  private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

  // Android runs periodic work at most every 15 minutes, and later in Doze.
  fun schedule(context: Context, intervalMinutes: Long) {
    val request = PeriodicWorkRequestBuilder<HistoryPollWorker>(
      intervalMinutes.coerceAtLeast(15), TimeUnit.MINUTES
    ).setConstraints(online).build()
    WorkManager.getInstance(context)
      .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
  }

  fun cancel(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
  }
}

class HistoryPollWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val context = applicationContext
    val config = HistoryPollStore.config(context) ?: return Result.success()
    if (AppVisibility.isInForeground) return Result.success()
    val outcome = JSONObject(
      HistoryPollNative.nativeCheck(config, HistoryPollStore.state(context), System.currentTimeMillis())
    )
    outcome.optJSONArray("errors")?.let { errors ->
      for (index in 0 until errors.length()) Log.w("ObbyHistoryPoll", errors.getString(index))
    }
    outcome.optJSONObject("state")?.let { HistoryPollStore.saveState(context, it.toString()) }
    outcome.optJSONArray("notices")?.let { ChatNotices.post(context, it) }
    return Result.success()
  }
}
