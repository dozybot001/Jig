package cn.tenonai.apps.jig

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import cn.tenonai.apps.jig.ui.Root

class MainActivity : ComponentActivity() {
    private val model get() = (application as JigApp).model

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handle(intent)
        setContent { Root(model) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onStart() {
        super.onStart()
        model.shown(true)
        model.syncService()
    }

    override fun onStop() {
        model.shown(false)
        super.onStop()
    }

    private fun handle(intent: Intent) {
        // A tapped notification: its session, or the approval center.
        // Each extra is taken off once it is acted on, so a redrawn screen does not act on it again.
        if (intent.getBooleanExtra(OPEN, false)) model.open(intent.getStringExtra(SESSION))
        intent.removeExtra(OPEN)
        if (BuildConfig.DEBUG) {
            // Debug builds only, for emulator runs: `--es jig.pair <jig://pair?…>` pairs as scanning
            // would, `--ez jig.demo true` opens the demo, `--es jig.tab approvals|letters` picks a tab.
            intent.getStringExtra("jig.pair")?.let(model::startPairing)
            if (intent.getBooleanExtra("jig.demo", false)) model.startDemo()
            when (intent.getStringExtra("jig.tab")) {
                "approvals" -> model.tab = Tab.Approvals
                "letters" -> model.tab = Tab.Letters
            }
            for (extra in listOf("jig.pair", "jig.demo", "jig.tab")) intent.removeExtra(extra)
        }
    }

    companion object {
        const val OPEN = "jig.open"
        const val SESSION = "jig.session"
    }
}
