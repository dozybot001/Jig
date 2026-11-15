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
 *
 * By default the connection lives only while Jig is open: closing Jig (swiping it away) ends it and
 * nothing starts it again but opening Jig. With "keep receiving after Jig is closed" on in Settings
 * it stays, and comes back after the phone starts, after an update, and after the system stopped it.
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

    // Restarted by the system after it was stopped for memory only when the person chose to keep it.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int =
        if ((application as JigApp).model.notifier.keepAfterClose) START_STICKY else START_NOT_STICKY

    // Jig was closed (swiped away from recent apps).
    override fun onTaskRemoved(rootIntent: Intent?) {
        val model = (application as JigApp).model
        if (!model.notifier.keepAfterClose) {
            stopSelf()
            model.closed()
        }
        super.onTaskRemoved(rootIntent)
    }

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

/**
 * After the phone starts, or the app is updated, the connection is kept again without opening the
 * app, when the person chose to keep it after Jig is closed. Otherwise nothing happens here.
 */
class StartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            val model = (context.applicationContext as JigApp).model
            if (model.notifier.keepAfterClose) model.syncService()
        }
    }
}
