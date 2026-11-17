package cn.tenonai.apps.yew.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.tenonai.apps.yew.AppModel
import cn.tenonai.apps.yew.Page
import cn.tenonai.apps.yew.R
import cn.tenonai.apps.yew.api.Entry
import cn.tenonai.apps.yew.api.MessageText
import cn.tenonai.apps.yew.api.SessionSummary
import cn.tenonai.apps.yew.api.Step
import cn.tenonai.apps.yew.api.ToolKinds
import cn.tenonai.apps.yew.api.obj
import cn.tenonai.apps.yew.api.str
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

/** A list that reloads when pulled down. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Refreshable(model: AppModel, reload: suspend () -> Unit, content: @Composable () -> Unit) {
    var refreshing by remember { mutableStateOf(false) }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            model.go {
                reload()
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) { content() }
}

/** All sessions, pinned first, with what each is doing; tap one to read and write in it. */
@Composable
fun SessionsList(model: AppModel) {
    Refreshable(model, { model.refreshAll() }) {
        LazyColumn(Modifier.fillMaxSize()) {
            items(model.orderedSessions, key = { it.id }) { session ->
                SessionRow(session) { model.pages.add(Page.Session(session)) }
            }
            if (model.loaded && model.sessions.isEmpty()) {
                item { Box(Modifier.fillParentMaxSize()) { Empty(Icons.Sessions, stringResource(R.string.sessions_empty)) } }
            }
        }
    }
}

@Composable
private fun SessionRow(session: SessionSummary, open: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = open).heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(if (session.cwd == null) Icons.Chat else Icons.Code, null, Modifier.size(22.dp), tint = colors.soft)
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(session.name, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (session.pinned) Icon(Icons.Pin, stringResource(R.string.pinned), Modifier.size(14.dp), tint = colors.soft)
        }
        StatusMark(session)
    }
}

/** Waiting, working and errors show as a dot; an idle session shows its unread count. */
@Composable
private fun StatusMark(session: SessionSummary) {
    val (color, label) = when (session.status) {
        "waiting" -> colors.waiting to R.string.status_waiting
        "working" -> colors.soft to R.string.status_working
        "error", "needs_review" -> colors.danger to R.string.status_attention
        else -> {
            if (session.unread > 0) {
                val unread = pluralStringResource(R.plurals.unread, session.unread, session.unread)
                Text(
                    "${session.unread}", color = colors.soft, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.semantics { contentDescription = unread },
                )
            }
            return
        }
    }
    val text = stringResource(label)
    Box(Modifier.size(8.dp).background(color, CircleShape).semantics { contentDescription = text })
}

/**
 * One session: its record, kept current from the computer's event stream, and a field to write to
 * it. While the session works, the answer appears as it is written, and the send button stops it.
 */
@Composable
fun SessionScreen(model: AppModel, session: SessionSummary, close: () -> Unit) {
    var entries by remember { mutableStateOf(listOf<Entry>()) }
    var status by remember { mutableStateOf(session.status) }
    var draft by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    // Where the part of the record before what is shown ends; null when all of it is shown.
    var older by remember { mutableStateOf<Int?>(null) }
    var loadingOlder by remember { mutableStateOf(false) }
    var message by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }

    suspend fun load(): Int? {
        val transcript = model.transcript(session.id) ?: return null
        // Read again after a drop: earlier parts that were already read stay.
        val first = transcript.entries.firstOrNull()?.seq
        val kept = if (first == null) emptyList() else entries.filter { it.seq < first }
        if (kept.isEmpty()) older = transcript.olderCursor
        entries = kept + transcript.entries
        status = transcript.session.status
        loaded = true
        return transcript.session.eventSeq
    }

    // Reads the record, then follows the session's events from where it ends; after a drop, reads it
    // again and picks up from there.
    LaunchedEffect(session.id, model.client) {
        while (true) {
            val after = load()
            val client = model.client ?: return@LaunchedEffect
            try {
                client.events(session.id, after).collect { event ->
                    val json = runCatching { Json.parseToJsonElement(event.data).jsonObject }.getOrNull() ?: return@collect
                    when (event.event) {
                        "session" -> when (json.str("type")) {
                            "entry" -> json.obj("entry")?.let(Entry::from)?.let { entry ->
                                entries = if (entries.any { it.id == entry.id }) {
                                    entries.map { if (it.id == entry.id) entry else it }
                                } else {
                                    entries + entry
                                }
                                if (entry.kind == Entry.Kind.Assistant) draft = null
                            }
                            "session" -> json.obj("session")?.str("status")?.let { status = it }
                        }
                        "live" -> when (json.str("type")) {
                            "draft" -> draft = MessageText.from(json.obj("draft")).text
                            "draftCleared" -> draft = null
                        }
                        "reset" -> load()
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // The banner on the first screen says what is wrong; here the record just waits.
            }
            delay(3_000)
        }
    }

    val steps = remember(entries) { Step.of(entries) }
    val list = rememberLazyListState()
    val working = status == "working"
    val rows = steps.size + (if (!draft.isNullOrEmpty()) 1 else 0) + (if (working) 1 else 0)
    // New entries at the end bring the end into view; reading an earlier part leaves the view where it is.
    val last = entries.lastOrNull()?.id
    LaunchedEffect(last, working, draft?.length) { if (rows > 0) list.scrollToItem(list.layoutInfo.totalItemsCount - 1, Int.MAX_VALUE / 2) }

    Screen(
        title = session.name,
        onBack = close,
        bottomBar = {
            Composer(
                message = message,
                onChange = { message = it },
                working = working,
                sending = sending,
                send = {
                    val text = message.trim()
                    if (text.isNotEmpty()) {
                        sending = true
                        model.go {
                            if (model.send(text, session.id)) {
                                message = ""
                                load()
                            }
                            sending = false
                        }
                    }
                },
                stop = { model.go { model.stop(session.id) } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (loaded && entries.isEmpty()) Empty(Icons.Chat, stringResource(R.string.messages_empty))
            // Reading the record through the relay can take seconds; the screen says it is on its way.
            if (!loaded) CircularProgressIndicator(Modifier.align(Alignment.Center), color = colors.soft)
            SelectionContainer {
                LazyColumn(
                    state = list,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    val before = older
                    if (before != null) {
                        item(key = "older") {
                            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                CapsuleButton(
                                    stringResource(R.string.messages_older), kind = ButtonKind.Secondary, busy = loadingOlder,
                                    onClick = {
                                        loadingOlder = true
                                        model.go {
                                            model.transcript(session.id, before)?.let { page ->
                                                entries = page.entries + entries
                                                older = page.olderCursor
                                            }
                                            loadingOlder = false
                                        }
                                    },
                                )
                            }
                        }
                    }
                    items(steps, key = { it.id }) { StepView(it) }
                    if (!draft.isNullOrEmpty()) item(key = "draft") { AnswerText(draft.orEmpty()) }
                    if (working) {
                        item(key = "working") {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(Icons.Dots, null, Modifier.size(18.dp), tint = colors.soft)
                                Text(stringResource(R.string.working), color = colors.soft, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Composer(message: String, onChange: (String) -> Unit, working: Boolean, sending: Boolean, send: () -> Unit, stop: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(colors.paper).navigationBarsPadding().imePadding()
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        GrowingField(message, onChange, stringResource(R.string.message_hint), Modifier.weight(1f))
        val stopping = working && message.isBlank()
        val enabled = stopping || (message.isNotBlank() && !sending)
        val label = stringResource(if (stopping) R.string.stop else R.string.send)
        Surface(
            onClick = if (stopping) stop else send,
            enabled = enabled,
            shape = CircleShape,
            color = if (enabled) colors.ink else colors.primary,
            contentColor = if (enabled) colors.paper else colors.soft,
            modifier = Modifier.size(48.dp).semantics { contentDescription = label },
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(if (stopping) Icons.Stop else Icons.Up, null, Modifier.size(24.dp))
            }
        }
    }
}

@Composable
private fun StepView(step: Step) {
    when (step) {
        is Step.User -> Box(Modifier.fillMaxWidth().padding(start = 40.dp), contentAlignment = Alignment.CenterEnd) {
            Text(
                step.entry.text,
                modifier = Modifier.background(colors.bubble, RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
            )
        }
        is Step.Letter -> Column(
            Modifier.fillMaxWidth().border(1.dp, colors.control, RoundedCornerShape(14.dp)).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Letters, null, Modifier.size(16.dp), tint = colors.soft)
                Text(
                    letterLine(senderName(step.letter.fromKind, step.letter.fromName), step.letter.kind),
                    color = colors.soft, style = MaterialTheme.typography.bodySmall,
                )
            }
            Text(step.letter.body)
        }
        is Step.Answer -> AnswerText(step.entry.text)
        is Step.Tools -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Tools, null, Modifier.size(16.dp), tint = colors.soft)
            Text(toolSummary(step.names), color = colors.soft, style = MaterialTheme.typography.bodySmall)
        }
        is Step.Notice -> Text(
            step.entry.text, color = colors.soft, style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** An answer's text, with its inline Markdown (bold, code, links) shown as such. */
@Composable
private fun AnswerText(text: String) {
    Text(inlineMarkdown(text), modifier = Modifier.fillMaxWidth())
}

/** "Read 1 file, ran 2 commands": the tools a stretch of work used, by kind, in the computer's wording. */
@Composable
private fun toolSummary(names: List<String>): String {
    return ToolKinds.count(names).mapIndexed { index, (kind, n) ->
        val part = pluralStringResource(
            when (kind) {
                "read" -> R.plurals.tools_read
                "edit" -> R.plurals.tools_edit
                "write" -> R.plurals.tools_write
                "search" -> R.plurals.tools_search
                "shell" -> R.plurals.tools_shell
                "web" -> R.plurals.tools_web
                "letter" -> R.plurals.tools_letter
                "session" -> R.plurals.tools_session
                "card" -> R.plurals.tools_card
                else -> R.plurals.tools_other
            },
            n, n,
        )
        // Only the first part keeps its capital (Chinese has none).
        if (index == 0) part else part.replaceFirstChar { it.lowercase() }
    }.joinToString(stringResource(R.string.tools_separator))
}

/** Who wrote a letter, as the computer names them: a session by its name, you, the command line, or a scheduled task. */
@Composable
fun senderName(kind: String?, name: String): String = when (kind) {
    "person" -> stringResource(R.string.sender_you)
    "cli" -> stringResource(R.string.sender_cli)
    "jig" -> stringResource(R.string.sender_schedule, name)
    else -> name
}

/** "Main · Request": who a letter is from and what kind it is. */
@Composable
fun letterLine(from: String, kind: String): String = "$from · " + stringResource(
    when (kind) {
        "request" -> R.string.letter_request
        "report" -> R.string.letter_report
        "decision" -> R.string.letter_decision
        else -> R.string.letter_notice
    },
)

/** Text in a fixed-width face, as commands are shown. */
val Mono = FontFamily.Monospace
