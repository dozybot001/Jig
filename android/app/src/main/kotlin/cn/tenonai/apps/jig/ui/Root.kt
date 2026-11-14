package cn.tenonai.apps.jig.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cn.tenonai.apps.jig.AppModel
import cn.tenonai.apps.jig.Link
import cn.tenonai.apps.jig.Page
import cn.tenonai.apps.jig.R
import cn.tenonai.apps.jig.Tab

/** Not connected yet: how to connect. Connected: the three places of the app, and the screens opened over them. */
@Composable
fun Root(model: AppModel) {
    JigTheme {
        val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            model.notifier.asked = true
            model.syncService()
        }
        // Just paired: ask once to show notifications, as the iPhone app does.
        LaunchedEffect(model.askForNotifications) {
            if (!model.askForNotifications) return@LaunchedEffect
            model.askForNotifications = false
            if (Build.VERSION.SDK_INT >= 33 && !model.notifier.allowed && !model.notifier.asked) {
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        val close = { if (model.pages.isNotEmpty()) model.pages.removeAt(model.pages.lastIndex) }
        BackHandler(enabled = model.pages.isNotEmpty()) { close() }
        when (val page = model.pages.lastOrNull()) {
            null -> if (model.connected) Tabs(model) else ConnectScreen(model)
            is Page.Session -> SessionScreen(model, page.session, close)
            is Page.Question -> QuestionScreen(model, page.approval, close)
            is Page.Decision -> DecisionScreen(model, page.card, close)
            is Page.Letter -> LetterScreen(model, page.letter, close)
            Page.Settings -> SettingsScreen(model, close)
            Page.About -> AboutScreen(model, close)
            is Page.Policy -> PolicyScreen(page.privacy, close)
            Page.Scanner -> ScannerScreen(model, close)
        }
        // What the computer said when it refused a request. The first screen shows its problem in place.
        val problem = model.problem
        if (problem != null && model.connected) {
            AlertDialog(
                onDismissRequest = { model.problem = null },
                title = { Text(stringResource(R.string.problem_title)) },
                text = { Text(problem) },
                confirmButton = { TextButton(onClick = { model.problem = null }) { Text(stringResource(R.string.ok)) } },
            )
        }
    }
}

@Composable
private fun Tabs(model: AppModel) {
    val title = when (model.tab) {
        Tab.Sessions -> R.string.tab_sessions
        Tab.Approvals -> R.string.tab_approvals
        Tab.Letters -> R.string.tab_letters
    }
    Screen(
        title = stringResource(title),
        actions = {
            IconButton(onClick = { model.pages.add(Page.Settings) }) {
                Icon(Icons.Settings, stringResource(R.string.settings))
            }
        },
        bottomBar = {
            Column(Modifier.background(colors.paper)) {
                Banner(model)
                NavigationBar(containerColor = colors.paper) {
                    val waiting = model.center?.count ?: 0
                    for ((tab, icon, label) in listOf(
                        Triple(Tab.Sessions, Icons.Sessions, R.string.tab_sessions),
                        Triple(Tab.Approvals, Icons.Approvals, R.string.tab_approvals),
                        Triple(Tab.Letters, Icons.Letters, R.string.tab_letters),
                    )) {
                        NavigationBarItem(
                            selected = model.tab == tab,
                            onClick = { model.tab = tab },
                            icon = {
                                if (tab == Tab.Approvals && waiting > 0) {
                                    BadgedBox(badge = {
                                        Badge(containerColor = colors.primary, contentColor = colors.onPrimary) { Text("$waiting") }
                                    }) { Icon(icon, null) }
                                } else {
                                    Icon(icon, null)
                                }
                            },
                            label = { Text(stringResource(label)) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = colors.ink, selectedTextColor = colors.ink, indicatorColor = colors.primary,
                                unselectedIconColor = colors.soft, unselectedTextColor = colors.soft,
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (model.tab) {
                Tab.Sessions -> SessionsList(model)
                Tab.Approvals -> CenterList(model)
                Tab.Letters -> LettersList(model)
            }
        }
    }
}

/** One line about the connection when something needs saying, with what the person can do about it. */
@Composable
private fun Banner(model: AppModel) {
    val (text, action, act) = when {
        model.isDemo -> Triple(R.string.banner_demo, R.string.leave) { model.leaveDemo() }
        model.link == Link.ComputerOffline -> Triple(R.string.banner_offline, R.string.retry) { model.go { model.refreshAll() }; Unit }
        model.link == Link.Refused -> Triple(R.string.banner_refused, R.string.pair_again) { model.go { model.unpair() }; Unit }
        model.link == Link.Unreachable -> Triple(R.string.banner_unreachable, R.string.retry) { model.go { model.refreshAll() }; Unit }
        else -> return
    }
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth()
            .border(1.dp, colors.control, RoundedCornerShape(16.dp)).padding(start = 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(text), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f).padding(vertical = 8.dp))
        TextButton(onClick = act) { Text(stringResource(action), fontWeight = FontWeight.SemiBold) }
    }
}
