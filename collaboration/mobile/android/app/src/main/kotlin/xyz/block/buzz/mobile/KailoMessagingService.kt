package xyz.block.buzz.mobile

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Legacy AndroidConfig v1 matches Core's existing FCM HTTP-v1 payload. */
class KailoMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        AndroidPushEvents.tokenChanged(token)
        // If Flutter is absent, the next foreground refresh asks the SDK for this same token.
        // Only Dart's current NativeSession may register it with Core.
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (!AndroidPushBridge.configured(this)) return
        val target = AndroidPushTarget.fromData(message.data) ?: return
        val body = message.notification?.body?.takeIf { it.isNotBlank() } ?: return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val notifications = NotificationManagerCompat.from(this)
        if (!notifications.areNotificationsEnabled()) return
        AndroidPushBridge.ensureChannel(this)
        val intent = Intent(this, MainActivity::class.java)
            .setData(Uri.Builder().scheme("kailo-push").authority(target.tenantId)
                .appendPath(target.channelId).appendPath(target.eventId).build())
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("tenant_id", target.tenantId)
            .putExtra("channel_id", target.channelId)
            .putExtra("event_id", target.eventId)
        val open = PendingIntent.getActivity(this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, AndroidPushBridge.CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(applicationInfo.loadLabel(packageManager))
            // This is Core's existing same-source localized fixed text, never fetched message content.
            .setContentText(body)
            .setNumber(message.notification?.notificationCount ?: 0)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        notifications.notify(message.collapseKey ?: target.eventId, 0, notification)
    }
}
