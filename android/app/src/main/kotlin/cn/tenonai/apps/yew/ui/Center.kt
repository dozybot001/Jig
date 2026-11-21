package cn.tenonai.apps.yew.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.tenonai.apps.yew.Answer
import cn.tenonai.apps.yew.AppModel
import cn.tenonai.apps.yew.Decision
import cn.tenonai.apps.yew.Page
import cn.tenonai.apps.yew.R
import cn.tenonai.apps.yew.api.ApprovalItem
import cn.tenonai.apps.yew.api.CardItem
import cn.tenonai.apps.yew.api.LetterItem

/**
 * The approval center on the phone: what every session waits on, in the computer's order. Permission
 * requests and held letters are answered in the list; questions and decision cards open to answer.
 */
@Composable
fun CenterList(model: AppModel) {
    Refreshable(model, { model.refreshCenter() }) {
        val center = model.center
        LazyColumn(Modifier.fillMaxSize()) {
            if (center != null) {
                val permissions = center.approvals.filter { it.kind == "permission" }
                val questions = center.approvals.filter { it.kind == "question" }
                if (permissions.isNotEmpty()) {
                    item(key = "permissions") { SectionTitle(stringResource(R.string.center_permissions)) }
                    items(permissions, key = { "approval:${it.id}" }) { PermissionRow(model, it) }
                }
                if (questions.isNotEmpty()) {
                    item(key = "questions") { SectionTitle(stringResource(R.string.center_questions)) }
                    items(questions, key = { "approval:${it.id}" }) { approval ->
                        Box(Modifier.fillMaxWidth().clickable { model.pages.add(Page.Question(approval)) }.padding(16.dp, 10.dp)) {
                            CardHead(model.name(approval.sessionId), approval.createdAt, approval.line)
                        }
                    }
                }
                if (center.cards.isNotEmpty()) {
                    item(key = "cards") { SectionTitle(stringResource(R.string.center_cards)) }
                    items(center.cards, key = { "card:${it.id}" }) { card ->
                        Box(Modifier.fillMaxWidth().clickable { model.pages.add(Page.Decision(card)) }.padding(16.dp, 10.dp)) {
                            CardHead(model.name(card.requestedBy), card.createdAt, "#${card.number} ${card.title}")
                        }
                    }
                }
                if (center.held.isNotEmpty()) {
                    item(key = "held") { SectionTitle(stringResource(R.string.center_held)) }
                    items(center.held, key = { "letter:${it.id}" }) { HeldLetterRow(model, it) }
                }
            }
            if (model.loaded && center?.count == 0) {
                item { Box(Modifier.fillParentMaxSize()) { Empty(R.drawable.mascot_happy, stringResource(R.string.center_empty)) } }
            }
        }
    }
}

/** A permission or approval request with its details, scope warning confirmation and actions. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PermissionRow(model: AppModel, approval: ApprovalItem) {
    var busy by remember { mutableStateOf<Decision?>(null) }
    var showDiff by remember { mutableStateOf(false) }
    var showChanges by remember { mutableStateOf(false) }
    var confirmWarning by remember { mutableStateOf(false) }
    val act = { decision: Decision, confirmedWarning: Boolean ->
        busy = decision
        model.go {
            model.answer(approval.id, decision, confirmedWarning = confirmedWarning)
            busy = null
        }
        Unit
    }
    Column(Modifier.fillMaxWidth().padding(16.dp, 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Tag(stringResource(R.string.kind_permission))
            // Cannot be taken back, or reaches other people: the automatic mode asks the person directly.
            if (approval.matter) Tag(stringResource(R.string.not_undoable), warning = true)
            if (approval.mustConfirm) Tag(stringResource(R.string.asks_every_time))
        }
        CardHead(model.name(approval.sessionId), approval.createdAt, approval.line)
        if (approval.description != null && approval.summary != null) {
            Text(
                approval.summary, color = colors.soft, fontFamily = Mono, style = MaterialTheme.typography.bodySmall,
                maxLines = 4, overflow = TextOverflow.Ellipsis,
            )
        }
        if (approval.reasons.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                approval.reasons.forEach { code ->
                    Text(
                        "• ${reasonLabel(code)}",
                        color = colors.soft,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        if (!approval.review.isNullOrEmpty()) {
            Text(
                stringResource(R.string.review_held, approval.review),
                color = colors.soft,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (approval.running.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    stringResource(R.string.site_running),
                    color = colors.soft,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                )
                approval.running.forEach { item ->
                    Text(
                        "• ${item.kind}: ${item.text}",
                        color = colors.soft,
                        fontFamily = Mono,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        if (approval.changes.isNotEmpty()) {
            Text(
                stringResource(R.string.planned_changes, approval.changes.size),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable { showChanges = !showChanges }.padding(vertical = 2.dp),
            )
            if (showChanges) {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    approval.changes.forEach { step ->
                        Text("• ${step.label}", color = colors.soft, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        if (!approval.diff.isNullOrEmpty()) {
            Text(
                stringResource(if (showDiff) R.string.hide_diff else R.string.view_diff),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable { showDiff = !showDiff }.padding(vertical = 2.dp),
            )
            if (showDiff) {
                Box(
                    Modifier.fillMaxWidth()
                        .heightIn(max = 220.dp)
                        .background(colors.bubble, RoundedCornerShape(8.dp))
                        .verticalScroll(rememberScrollState())
                        .horizontalScroll(rememberScrollState())
                        .padding(8.dp),
                ) {
                    Text(approval.diff, fontFamily = Mono, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CapsuleButton(
                stringResource(R.string.allow), { act(Decision.AllowOnce, false) }, icon = Icons.Check,
                enabled = busy == null, busy = busy == Decision.AllowOnce,
            )
            if (!approval.mustConfirm && approval.canRemember) {
                CapsuleButton(
                    stringResource(R.string.always),
                    {
                        if (approval.warning == "acts-as-you") confirmWarning = true
                        else act(Decision.AllowAlways, false)
                    },
                    kind = ButtonKind.Secondary,
                    icon = Icons.Approvals, enabled = busy == null, busy = busy == Decision.AllowAlways,
                )
            }
            CapsuleButton(
                stringResource(R.string.decline), { act(Decision.Deny, false) }, kind = ButtonKind.Destructive,
                icon = Icons.Block, enabled = busy == null, busy = busy == Decision.Deny,
            )
        }
    }
    if (confirmWarning) {
        AlertDialog(
            onDismissRequest = { confirmWarning = false },
            title = { Text(stringResource(R.string.always_acts_as_you_title)) },
            text = { Text(stringResource(R.string.always_acts_as_you_body)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmWarning = false
                    act(Decision.AllowAlways, true)
                }) { Text(stringResource(R.string.always_allow_confirm), color = colors.danger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmWarning = false }) { Text(stringResource(R.string.cancel)) }
            },
        )
    }
}

@Composable
private fun reasonLabel(code: String): String = when (code) {
    "git-setup" -> stringResource(R.string.reason_git_setup)
    "launch-app" -> stringResource(R.string.reason_launch_app)
    "outside-sandbox" -> stringResource(R.string.reason_outside_sandbox)
    "connect-site" -> stringResource(R.string.reason_connect_site)
    "connect-site-unsure" -> stringResource(R.string.reason_connect_site_unsure)
    "remote-machine" -> stringResource(R.string.reason_remote_machine)
    "remote-copy" -> stringResource(R.string.reason_remote_copy)
    "send-data" -> stringResource(R.string.reason_send_data)
    "delete-files" -> stringResource(R.string.reason_delete_files)
    "delete-outside" -> stringResource(R.string.reason_delete_outside)
    "write-outside" -> stringResource(R.string.reason_write_outside)
    "push" -> stringResource(R.string.reason_push)
    "publish-package" -> stringResource(R.string.reason_publish_package)
    "publish-image" -> stringResource(R.string.reason_publish_image)
    "github" -> stringResource(R.string.reason_github)
    "write-disk" -> stringResource(R.string.reason_write_disk)
    "system-services" -> stringResource(R.string.reason_system_services)
    "yew-data" -> stringResource(R.string.reason_yew_data)
    "yew-cli" -> stringResource(R.string.reason_yew_cli)
    "hidden-folder" -> stringResource(R.string.reason_hidden_folder)
    "browser-action" -> stringResource(R.string.reason_browser_action)
    "browser-script" -> stringResource(R.string.reason_browser_script)
    "computer-control" -> stringResource(R.string.reason_computer_control)
    "service-action" -> stringResource(R.string.reason_service_action)
    else -> code
}

/** A letter held for the person: who wrote to whom, why it waits, and release or refuse. */
@Composable
private fun HeldLetterRow(model: AppModel, letter: LetterItem) {
    var busy by remember { mutableStateOf<Boolean?>(null) }
    val settle = { release: Boolean ->
        busy = release
        model.go {
            model.settle(letter.id, release)
            busy = null
        }
        Unit
    }
    Column(Modifier.fillMaxWidth().padding(16.dp, 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        CardHead(
            "${senderName(letter.fromKind, letter.fromName)} → ${model.name(letter.toSession)}", letter.createdAt, letter.summary,
        )
        if (letter.body.isNotEmpty()) {
            Text(letter.body, color = colors.soft, style = MaterialTheme.typography.bodySmall, maxLines = 4, overflow = TextOverflow.Ellipsis)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CapsuleButton(stringResource(R.string.release), { settle(true) }, icon = Icons.Check, enabled = busy == null, busy = busy == true)
            CapsuleButton(
                stringResource(R.string.refuse), { settle(false) }, kind = ButtonKind.Destructive, icon = Icons.Block,
                enabled = busy == null, busy = busy == false,
            )
        }
    }
}

/** The bar at the bottom of a page with its one main button, above the keyboard and the system bar. */
@Composable
private fun ActionBar(text: String, enabled: Boolean, busy: Boolean, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(16.dp, 8.dp)) {
        CapsuleButton(text, onClick, Modifier.fillMaxWidth(), enabled = enabled, busy = busy)
    }
}

/**
 * Questions from a session: options to pick (the recommended one chosen to start with) and a line for
 * the person's own words; one button answers them all.
 */
@Composable
fun QuestionScreen(model: AppModel, approval: ApprovalItem, close: () -> Unit) {
    val questions = approval.questions
    val choices = remember {
        mutableStateListOf<Set<Int>>().apply {
            addAll(questions.map { q -> q.recommended?.takeIf { it in q.options.indices }?.let(::setOf) ?: emptySet() })
        }
    }
    val texts = remember { mutableStateListOf<String>().apply { addAll(questions.map { "" }) } }
    var busy by remember { mutableStateOf(false) }
    val ready = questions.indices.all { choices[it].isNotEmpty() || texts[it].isNotBlank() }

    Screen(
        title = model.name(approval.sessionId),
        onBack = close,
        bottomBar = {
            ActionBar(stringResource(R.string.answer), ready, busy) {
                busy = true
                model.go {
                    val answers = questions.indices.map { Answer(choices[it].sorted(), texts[it].trim().ifEmpty { null }) }
                    if (model.answer(approval.id, answers)) close()
                    busy = false
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            questions.forEachIndexed { index, question ->
                Text(
                    question.header?.let { "$it · ${question.question}" } ?: question.question,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
                )
                question.options.forEachIndexed { choice, option ->
                    OptionRow(option, choice == question.recommended, choice in choices[index], question.multiple) {
                        choices[index] = when {
                            !question.multiple -> setOf(choice)
                            choice in choices[index] -> choices[index] - choice
                            else -> choices[index] + choice
                        }
                    }
                }
                GrowingField(
                    texts[index],
                    { value ->
                        texts[index] = value
                        // Own words replace the picked option of a one-choice question.
                        if (value.isNotEmpty() && !question.multiple) choices[index] = emptySet()
                    },
                    stringResource(if (question.options.isEmpty()) R.string.your_answer else R.string.something_else),
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                )
                if (question.multiple) Footnote(stringResource(R.string.pick_any))
            }
        }
    }
}

/** A decision card: the question, its context, the options with the recommended one chosen, a note. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DecisionScreen(model: AppModel, card: CardItem, close: () -> Unit) {
    var choice by remember { mutableStateOf(card.recommended) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    Screen(
        title = stringResource(R.string.decision),
        onBack = close,
        bottomBar = {
            ActionBar(stringResource(R.string.send), choice != null || note.isNotBlank(), busy) {
                busy = true
                model.go {
                    if (model.decide(card.id, choice, note.trim().ifEmpty { null })) close()
                    busy = false
                }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            Column(Modifier.padding(16.dp, 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    listOf("#${card.number}", model.name(card.requestedBy)).filter { it.isNotEmpty() }.joinToString(" · "),
                    color = colors.soft, style = MaterialTheme.typography.bodySmall,
                )
                Text(card.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    card.deadline?.let { Tag(stringResource(R.string.due, it)) }
                    card.undoable?.let {
                        Tag(stringResource(if (it) R.string.undoable else R.string.not_undoable), warning = !it)
                    }
                }
                if (card.context.isNotEmpty()) Text(inlineMarkdown(card.context), color = colors.soft)
            }
            if (card.options.isNotEmpty()) {
                SectionTitle(stringResource(R.string.options))
                card.options.forEachIndexed { index, option ->
                    OptionRow(option, index == card.recommended, choice == index, multiple = false) { choice = index }
                }
            }
            GrowingField(
                note, { note = it },
                stringResource(if (card.options.isEmpty()) R.string.your_answer else R.string.add_note),
                Modifier.fillMaxWidth().padding(16.dp, 12.dp),
            )
        }
    }
}
