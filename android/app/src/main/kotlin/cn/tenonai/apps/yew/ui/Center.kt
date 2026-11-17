package cn.tenonai.apps.yew.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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

/** A permission request with its answers: allow, always allow this kind when offered, decline. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PermissionRow(model: AppModel, approval: ApprovalItem) {
    var busy by remember { mutableStateOf<Decision?>(null) }
    val act = { decision: Decision ->
        busy = decision
        model.go {
            model.answer(approval.id, decision)
            busy = null
        }
        Unit
    }
    Column(Modifier.fillMaxWidth().padding(16.dp, 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        CardHead(model.name(approval.sessionId), approval.createdAt, approval.line)
        if (approval.description != null && approval.summary != null) {
            Text(
                approval.summary, color = colors.soft, fontFamily = Mono, style = MaterialTheme.typography.bodySmall,
                maxLines = 4, overflow = TextOverflow.Ellipsis,
            )
        }
        if (approval.mustConfirm) Tag(stringResource(R.string.asks_every_time))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            CapsuleButton(
                stringResource(R.string.allow), { act(Decision.AllowOnce) }, icon = Icons.Check,
                enabled = busy == null, busy = busy == Decision.AllowOnce,
            )
            if (!approval.mustConfirm && approval.canRemember) {
                CapsuleButton(
                    stringResource(R.string.always), { act(Decision.AllowAlways) }, kind = ButtonKind.Secondary,
                    icon = Icons.Approvals, enabled = busy == null, busy = busy == Decision.AllowAlways,
                )
            }
            CapsuleButton(
                stringResource(R.string.decline), { act(Decision.Deny) }, kind = ButtonKind.Destructive,
                icon = Icons.Block, enabled = busy == null, busy = busy == Decision.Deny,
            )
        }
    }
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
