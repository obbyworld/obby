package world.obby.notifications

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/** The Rust check, linked from the app library. */
object BackgroundCheck {
  init {
    System.loadLibrary("app_lib")
  }

  @JvmStatic external fun nativeCheck(config: String, state: String, now: Long): String
}

object BackgroundStore {
  private const val PREFERENCES = "obby_background_check"

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

object BackgroundScheduler {
  private const val PERIODIC = "obby-background-check"
  private const val ONCE = "obby-background-check-now"

  private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

  // Android runs periodic work at most every 15 minutes, and later in Doze.
  fun schedule(context: Context, intervalMinutes: Long) {
    val request = PeriodicWorkRequestBuilder<BackgroundCheckWorker>(
      intervalMinutes.coerceAtLeast(15), TimeUnit.MINUTES
    ).setConstraints(online).build()
    WorkManager.getInstance(context)
      .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
  }

  fun runOnce(context: Context) {
    val request = OneTimeWorkRequestBuilder<BackgroundCheckWorker>().setConstraints(online).build()
    WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, request)
  }

  fun cancel(context: Context) {
    WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
  }
}

class BackgroundCheckWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val context = applicationContext
    val config = BackgroundStore.config(context) ?: return Result.success()
    if (AppVisibility.isInForeground) return Result.success()
    val outcome = JSONObject(
      BackgroundCheck.nativeCheck(config, BackgroundStore.state(context), System.currentTimeMillis())
    )
    outcome.optJSONObject("state")?.let { BackgroundStore.saveState(context, it.toString()) }
    outcome.optJSONArray("notices")?.let { BackgroundNotices.post(context, it) }
    return Result.success()
  }
}
