package xyz.block.buzz.mobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

/** DD-151: the existing buzz/push protocol, backed by the official FCM client SDK. */
internal class AndroidPushBridge(
    private val activity: FlutterFragmentActivity,
    messenger: BinaryMessenger,
) {
    private val channel = MethodChannel(messenger, "buzz/push")
    private val pending = PendingPushTarget()
    private val preferences = activity.getSharedPreferences("push_permission", Context.MODE_PRIVATE)
    private val permission = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        channel.invokeMethod("notificationAuthorizationChanged", null)
    }
    private val tokenListener: (String) -> Unit = { token ->
        channel.invokeMethod("fcmTokenChanged", mapOf("token" to token))
    }

    init {
        AndroidPushEvents.listener = tokenListener
        if (configured(activity)) ensureChannel(activity)
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "pushPlatform" -> result.success(if (configured(activity)) "FCM" else null)
                "notificationAuthorizationStatus" -> result.success(authorizationStatus())
                "openNotificationSettings" -> {
                    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
                    activity.startActivity(intent)
                    result.success(true)
                }
                "startRegistration" -> {
                    if (!configured(activity)) {
                        result.error("push_unavailable", "push_unavailable", null)
                    } else {
                        ensureChannel(activity)
                        if (call.argument<Boolean>("requestPermission") != false &&
                            Build.VERSION.SDK_INT >= 33 &&
                            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                            preferences.edit().putBoolean("asked", true).apply()
                            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                        val messaging = FirebaseMessaging.getInstance()
                        messaging.isAutoInitEnabled = true
                        messaging.token.addOnCompleteListener { task ->
                            val token = if (task.isSuccessful) task.result else null
                            if (token.isNullOrBlank()) {
                                result.error("push_registration_failed", "push_registration_failed", null)
                            } else {
                                tokenListener(token)
                                result.success(null)
                            }
                        }
                    }
                }
                "takePendingNotificationResponse" -> {
                    val target = pending.take()
                    if (target != null) clearIntent(target)
                    result.success(target?.flutterArguments())
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun authorizationStatus(): String? {
        if (!configured(activity)) return null
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return if (preferences.getBoolean("asked", false)) "denied" else "notDetermined"
        }
        return if (NotificationManagerCompat.from(activity).areNotificationsEnabled()) "authorized" else "denied"
    }

    fun opened(intent: Intent?) {
        val target = AndroidPushTarget.fromData(mapOf(
            "tenant_id" to intent?.getStringExtra("tenant_id"),
            "channel_id" to intent?.getStringExtra("channel_id"),
            "event_id" to intent?.getStringExtra("event_id"),
        )) ?: return
        pending.record(target)
        channel.invokeMethod("notificationOpened", target.flutterArguments(), object : MethodChannel.Result {
            override fun success(result: Any?) {
                if (result == "handled") {
                    pending.removeIfMatching(target)
                    clearIntent(target)
                }
            }
            override fun error(code: String, message: String?, details: Any?) = Unit
            override fun notImplemented() = Unit
        })
    }

    private fun clearIntent(target: AndroidPushTarget) {
        val intent = activity.intent ?: return
        val current = AndroidPushTarget.fromData(mapOf(
            "tenant_id" to intent.getStringExtra("tenant_id"),
            "channel_id" to intent.getStringExtra("channel_id"),
            "event_id" to intent.getStringExtra("event_id"),
        ))
        if (current != target) return
        intent.removeExtra("tenant_id")
        intent.removeExtra("channel_id")
        intent.removeExtra("event_id")
    }

    fun dispose() {
        if (AndroidPushEvents.listener === tokenListener) AndroidPushEvents.listener = null
        permission.unregister()
        channel.setMethodCallHandler(null)
    }

    companion object {
        const val CHANNEL_ID = "kailo_messages"
        fun configured(context: Context): Boolean = runCatching {
            val app = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
                ?: FirebaseApp.initializeApp(context)
            app != null && app.options.applicationId.isNotBlank() && !app.options.gcmSenderId.isNullOrBlank()
        }.getOrDefault(false)

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= 26) {
                val label = context.applicationInfo.loadLabel(context.packageManager)
                context.getSystemService(NotificationManager::class.java).createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, label, NotificationManager.IMPORTANCE_DEFAULT),
                )
            }
        }
    }
}

/** FCM keeps its own token. The app never duplicates it in preferences or logs. */
internal object AndroidPushEvents {
    var listener: ((String) -> Unit)? = null
    fun tokenChanged(token: String) {
        Handler(Looper.getMainLooper()).post { listener?.invoke(token) }
    }
}
