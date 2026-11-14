package cn.tenonai.apps.jig

import android.app.Application

class JigApp : Application() {
    /** The one model of the process, shared by the screens and the connection service. */
    val model: AppModel by lazy { AppModel(this) }
}
