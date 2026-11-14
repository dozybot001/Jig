package cn.tenonai.apps.jig.api

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

// Jig's local API as the Android app reads it: the same endpoints the web interface uses on the
// computer. Only the fields the app shows are read; the rest is ignored.

internal fun JsonObject.str(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content
internal fun JsonObject.int(name: String): Int? = (this[name] as? JsonPrimitive)?.intOrNull
internal fun JsonObject.num(name: String): Double? = (this[name] as? JsonPrimitive)?.doubleOrNull
internal fun JsonObject.bool(name: String): Boolean? = (this[name] as? JsonPrimitive)?.booleanOrNull
internal fun JsonObject.obj(name: String): JsonObject? = this[name] as? JsonObject
internal fun JsonObject.list(name: String): List<JsonElement> = (this[name] as? JsonArray).orEmpty()
internal fun JsonObject.objects(name: String): List<JsonObject> = list(name).filterIsInstance<JsonObject>()

data class SessionSummary(
    val id: String,
    val name: String,
    val kind: String,
    val cwd: String?,
    val status: String,
    val pinned: Boolean,
    val unread: Int,
    /** The sequence number of the session's last event; the event stream resumes after it. */
    val eventSeq: Int?,
) {
    companion object {
        fun from(json: JsonObject): SessionSummary? {
            return SessionSummary(
                id = json.str("id") ?: return null,
                name = json.str("name").orEmpty(),
                kind = json.str("kind").orEmpty(),
                cwd = json.str("cwd"),
                status = json.str("status").orEmpty(),
                pinned = json.bool("pinned") ?: false,
                unread = json.int("unread") ?: 0,
                eventSeq = json.int("eventSeq"),
            )
        }
    }
}

/** A message's text blocks joined, and the tools it called; also the shape of an answer still being written. */
class MessageText(val text: String, val tools: List<String>) {
    companion object {
        fun from(message: JsonObject?): MessageText {
            val content = message?.get("content")
            if (content is JsonPrimitive && content.isString) return MessageText(content.content, emptyList())
            val blocks = (content as? JsonArray).orEmpty().filterIsInstance<JsonObject>()
            return MessageText(
                text = blocks.filter { it.str("type") == "text" }.mapNotNull { it.str("text") }.joinToString("\n\n"),
                tools = blocks.filter { it.str("type") == "toolCall" }.mapNotNull { it.str("name") },
            )
        }
    }
}

/** Who sent a letter into a session, and what kind it is. */
class LetterRef(
    val kind: String,
    /** session, person, cli, or jig (a scheduled task). */
    val fromKind: String?,
    val fromName: String,
    val summary: String,
    val body: String,
)

/**
 * One entry of a session's record, reduced to what a phone shows: who spoke, the text, the tools an
 * answer used, and the letter a message came in.
 */
class Entry(
    val id: String,
    val seq: Int,
    val kind: Kind,
    val text: String,
    /** The tools the assistant called in this message, by name, in order. */
    val tools: List<String>,
    /** The letter this message delivered, when it came from another session. */
    val letter: LetterRef?,
) {
    enum class Kind { User, Assistant, Notice, Other }

    companion object {
        fun from(json: JsonObject): Entry? {
            val id = json.str("id") ?: return null
            val letter = json.obj("letter")?.let { letter ->
                val from = letter.obj("from")
                LetterRef(
                    kind = letter.str("kind").orEmpty(),
                    fromKind = from?.str("kind"),
                    fromName = from?.str("name").orEmpty(),
                    summary = letter.str("summary").orEmpty(),
                    body = letter.str("body").orEmpty(),
                )
            }
            val message = MessageText.from(json.obj("message"))
            return when (json.str("role")) {
                "user" -> Entry(id, json.int("seq") ?: 0, Kind.User, message.text, emptyList(), letter)
                "assistant" -> Entry(id, json.int("seq") ?: 0, Kind.Assistant, message.text, message.tools, letter)
                "notice" -> Entry(
                    id, json.int("seq") ?: 0, Kind.Notice, json.obj("notice")?.str("text").orEmpty(), emptyList(), letter,
                )
                else -> Entry(id, json.int("seq") ?: 0, Kind.Other, "", emptyList(), letter)
            }
        }
    }
}

class Transcript(val session: SessionSummary, val entries: List<Entry>) {
    companion object {
        fun from(json: JsonObject): Transcript? {
            val session = json.obj("session")?.let(SessionSummary::from) ?: return null
            return Transcript(session, json.objects("entries").mapNotNull(Entry::from))
        }
    }
}

data class Choice(val label: String, val detail: String?) {
    companion object {
        /** Options come as objects, or as plain strings in questions asked before options had details. */
        fun from(json: JsonElement): Choice? = when (json) {
            is JsonPrimitive -> if (json.isString) Choice(json.content, null) else null
            is JsonObject -> json.str("label")?.let { Choice(it, json.str("detail")) }
            else -> null
        }

        fun list(json: JsonObject, name: String): List<Choice> = json.list(name).mapNotNull(::from)
    }
}

class Question(
    val question: String,
    val header: String?,
    val options: List<Choice>,
    val recommended: Int?,
    val multiple: Boolean,
)

class ApprovalItem(
    val id: String,
    val sessionId: String,
    val kind: String,
    val createdAt: Double,
    val tool: String?,
    val summary: String?,
    val description: String?,
    val mustConfirm: Boolean,
    /** The request offers to remember this kind of operation ("Always"). */
    val canRemember: Boolean,
    /** The questions, whichever form they were saved in (src/shared/types.ts questionsOf). */
    val questions: List<Question>,
) {
    /** The line the list shows: what the session wants to do, or its first question. */
    val line: String
        get() = if (kind == "question") questions.firstOrNull()?.question.orEmpty() else description ?: summary ?: tool.orEmpty()

    companion object {
        fun from(json: JsonObject): ApprovalItem? {
            val request = json.obj("request") ?: JsonObject(emptyMap())
            val questions = request.objects("questions").map {
                Question(
                    question = it.str("question").orEmpty(),
                    header = it.str("header"),
                    options = Choice.list(it, "options"),
                    recommended = it.int("recommended"),
                    multiple = it.bool("multiple") ?: false,
                )
            }.ifEmpty {
                listOf(Question(request.str("question").orEmpty(), null, Choice.list(request, "options"), null, false))
            }
            return ApprovalItem(
                id = json.str("id") ?: return null,
                sessionId = json.str("sessionId").orEmpty(),
                kind = json.str("kind").orEmpty(),
                createdAt = json.num("createdAt") ?: 0.0,
                tool = request.str("tool"),
                summary = request.str("summary"),
                description = request.str("description"),
                mustConfirm = request.bool("mustConfirm") ?: false,
                canRemember = request.list("rememberRules").isNotEmpty(),
                questions = questions,
            )
        }
    }
}

class CardItem(
    val id: String,
    val number: Int,
    val title: String,
    val context: String,
    val options: List<Choice>,
    val recommended: Int?,
    val deadline: String?,
    val undoable: Boolean?,
    val requestedBy: String?,
    val createdAt: Double,
) {
    companion object {
        fun from(json: JsonObject): CardItem? {
            return CardItem(
                id = json.str("id") ?: return null,
                number = json.int("number") ?: 0,
                title = json.str("title").orEmpty(),
                context = json.str("context").orEmpty(),
                options = Choice.list(json, "options"),
                recommended = json.int("recommended"),
                deadline = json.str("deadline"),
                undoable = json.bool("undoable"),
                requestedBy = json.str("requestedBy"),
                createdAt = json.num("createdAt") ?: 0.0,
            )
        }
    }
}

class LetterItem(
    val id: String,
    val fromKind: String?,
    val fromName: String,
    val toSession: String,
    val kind: String,
    val summary: String,
    val body: String,
    val status: String,
    val createdAt: Double,
) {
    companion object {
        fun from(json: JsonObject): LetterItem? {
            return LetterItem(
                id = json.str("id") ?: return null,
                fromKind = json.str("fromKind"),
                fromName = json.str("fromName").orEmpty(),
                toSession = json.str("toSession").orEmpty(),
                kind = json.str("kind").orEmpty(),
                summary = json.str("summary").orEmpty(),
                body = json.str("body").orEmpty(),
                status = json.str("status").orEmpty(),
                createdAt = json.num("createdAt") ?: 0.0,
            )
        }
    }
}

/** What the approval center waits on: permission requests and questions, decision cards, held letters. */
class Center(val approvals: List<ApprovalItem>, val cards: List<CardItem>, val held: List<LetterItem>) {
    val count: Int get() = approvals.size + cards.size + held.size

    /** One key per waiting item, as the computer's notifier names them (src/server/push.ts). */
    val keys: Set<String>
        get() = (approvals.map { "approval:${it.id}" } + cards.map { "card:${it.id}" } + held.map { "letter:${it.id}" }).toSet()

    companion object {
        fun from(json: JsonObject) = Center(
            approvals = json.objects("approvals").mapNotNull(ApprovalItem::from),
            cards = json.objects("cards").mapNotNull(CardItem::from),
            held = json.objects("held").mapNotNull(LetterItem::from),
        )
    }
}

/**
 * What the phone shows of a record: messages, letters and notices, and the tools a stretch of work
 * used, counted in one line (as the computer's run summary does).
 */
sealed class Step {
    abstract val id: String

    class User(val entry: Entry) : Step() { override val id get() = entry.id }
    class Letter(val entry: Entry, val letter: LetterRef) : Step() { override val id get() = entry.id }
    class Answer(val entry: Entry) : Step() { override val id get() = entry.id }
    class Tools(private val first: String, val names: List<String>) : Step() { override val id get() = "tools-$first" }
    class Notice(val entry: Entry) : Step() { override val id get() = entry.id }

    companion object {
        fun of(entries: List<Entry>): List<Step> {
            val steps = mutableListOf<Step>()
            val tools = mutableListOf<String>()
            var toolsId = ""
            fun flush() {
                if (tools.isNotEmpty()) steps.add(Tools(toolsId, tools.toList()))
                tools.clear()
            }
            for (entry in entries) {
                when (entry.kind) {
                    Entry.Kind.Assistant -> {
                        if (tools.isEmpty()) toolsId = entry.id
                        tools += entry.tools
                        if (entry.text.isNotEmpty()) {
                            flush()
                            steps.add(Answer(entry))
                        }
                    }
                    Entry.Kind.User -> {
                        flush()
                        if (entry.letter != null) steps.add(Letter(entry, entry.letter))
                        else if (entry.text.isNotEmpty()) steps.add(User(entry))
                    }
                    Entry.Kind.Notice -> {
                        flush()
                        if (entry.text.isNotEmpty()) steps.add(Notice(entry))
                    }
                    Entry.Kind.Other -> Unit
                }
            }
            flush()
            return steps
        }
    }
}

/** The kinds the tools of a stretch of work are counted by, in the order the summary lists them. */
object ToolKinds {
    val order = listOf("read", "edit", "write", "search", "shell", "web", "letter", "session", "card", "other")

    fun of(tool: String): String = when (tool) {
        "read", "edit", "write" -> tool
        "grep", "glob" -> "search"
        "shell", "shell_job" -> "shell"
        "web_fetch" -> "web"
        "send_letter" -> "letter"
        "open_session" -> "session"
        "post_card", "update_card", "withdraw_card" -> "card"
        else -> "other"
    }

    /** Each kind that was used and how often, in the summary's order. */
    fun count(names: List<String>): List<Pair<String, Int>> {
        val counts = names.groupingBy(::of).eachCount()
        return order.mapNotNull { kind -> counts[kind]?.let { kind to it } }
    }
}
