package cn.tenonai.apps.yew

import android.app.Application

class YewApp : Application() {
    /** The one model of the process, shared by the screens and the connection service. */
    val model: AppModel by lazy { AppModel(this) }
}
