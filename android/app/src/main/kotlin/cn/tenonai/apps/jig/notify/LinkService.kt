package cn.tenonai.apps.jig.notify

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.compose.runtime.snapshotFlow
import cn.tenonai.apps.jig.JigApp
import cn.tenonai.apps.jig.MainActivity
import cn.tenonai.apps.jig.R
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Keeps the app's connection to the relay while the app is not on screen, so the computer can tell
 * this phone when something needs the person (blueprint section 13: no push service is used).
 * Android requires a standing notification for it, which says whether the computer is reached.
 * When the system stops the app, nothing arrives until it runs again; Settings says so.
 */
class LinkService : Service() {
    private val scope = MainScope()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val model = (application as JigApp).model
        val first = status(model.listening, model.desktopName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(Notifier.SERVICE, first, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        } else {
            startForeground(Notifier.SERVICE, first)
        }
        if (!model.wantsNotes) {
            stopSelf()
            return
        }
        model.listen(true)
        scope.launch {
            snapshotFlow { model.listening to model.desktopName }.collect { (listening, name) ->
                getSystemService(NotificationManager::class.java).notify(Notifier.SERVICE, status(listening, name))
            }
        }
    }

    // Restarted by the system after it was stopped for memory, as long as the person wants notifications.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        scope.cancel()
        (application as JigApp).model.listen(false)
        super.onDestroy()
    }

    private fun status(listening: Boolean, computer: String?): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, Notifier.LINK)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.service_title))
            .setContentText(getString(if (listening) R.string.service_online else R.string.service_waiting, computer.orEmpty()))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }
}

/** After the phone starts, or the app is updated, the connection is kept again without opening the app. */
class StartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            (context.applicationContext as JigApp).model.syncService()
        }
    }
}
