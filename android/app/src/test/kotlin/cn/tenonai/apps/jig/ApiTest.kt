package cn.tenonai.apps.jig

import cn.tenonai.apps.jig.api.ApprovalItem
import cn.tenonai.apps.jig.api.Center
import cn.tenonai.apps.jig.api.Entry
import cn.tenonai.apps.jig.api.InlineKind
import cn.tenonai.apps.jig.api.inlinePieces
import cn.tenonai.apps.jig.api.SseParser
import cn.tenonai.apps.jig.api.Step
import cn.tenonai.apps.jig.api.ToolKinds
import cn.tenonai.apps.jig.notify.Note
import cn.tenonai.apps.jig.notify.NoteText
import cn.tenonai.apps.jig.remote.unpackBody
import java.io.IOException
import org.junit.Assert.assertThrows
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun json(text: String) = Json.parseToJsonElement(text).jsonObject

/** The computer's answers as the app reads them: the event stream, the record, the approval center, a notification. */
class ApiTest {
    @Test
    fun eventStreamIsCutIntoEventsWhateverThePieces() {
        val parser = SseParser()
        assertEquals(0, parser.feed("event: hel").size)
        val first = parser.feed("lo\ndata: {}\n\n: keepalive\n\nevent: note\ndata: {\"id\":")
        assertEquals(listOf("hello"), first.map { it.event })
        assertEquals("{}", first[0].data)
        val second = parser.feed("\"n1\"}\n\ndata: plain\n\n")
        assertEquals(listOf("note", "message"), second.map { it.event })
        assertEquals("{\"id\":\"n1\"}", second[0].data)
    }

    @Test
    fun recordBecomesMessagesLettersAndOneLineOfTools() {
        val entries = listOf(
            """{"id":"e1","seq":1,"role":"user","message":{"content":"推送"}}""",
            """{"id":"e2","seq":2,"role":"assistant","message":{"content":[{"type":"toolCall","name":"read"},{"type":"toolCall","name":"grep"}]}}""",
            """{"id":"e3","seq":3,"role":"assistant","message":{"content":[{"type":"toolCall","name":"shell"},{"type":"text","text":"好了"}]}}""",
            """{"id":"e4","seq":4,"role":"user","message":{"content":"请看"},"letter":{"kind":"request","from":{"kind":"session","name":"总办"},"summary":"s","body":"请看"}}""",
            """{"id":"e5","seq":5,"role":"notice","notice":{"kind":"budget","text":"到上限"}}""",
            """{"id":"e6","seq":6,"role":"toolResult"}""",
        ).mapNotNull { Entry.from(json(it)) }
        val steps = Step.of(entries)
        assertEquals(listOf("e1", "tools-e2", "e3", "e4", "e5"), steps.map { it.id })
        assertEquals(listOf("read", "grep", "shell"), (steps[1] as Step.Tools).names)
        assertEquals("总办", (steps[3] as Step.Letter).letter.fromName)
        assertEquals(listOf("read" to 1, "search" to 1, "shell" to 2, "other" to 1), ToolKinds.count(listOf("shell", "read", "glob", "shell_job", "manage_jig")))
    }

    @Test
    fun approvalCenterReadsBothFormsOfQuestions() {
        val center = Center.from(json(
            """{"approvals":[
                {"id":"a1","sessionId":"s","kind":"permission","createdAt":1,"request":{"tool":"shell","summary":"git push","rememberRules":[{"tool":"shell"}]}},
                {"id":"a2","sessionId":"s","kind":"question","createdAt":2,"request":{"question":"哪个？","options":["甲",{"label":"乙","detail":"说明"}]}},
                {"id":"a3","sessionId":"s","kind":"question","createdAt":3,"request":{"questions":[{"question":"颜色？","options":[{"label":"黑"}],"recommended":0,"multiple":true}]}}
            ],"cards":[{"id":"c1","number":12,"title":"发布","context":"","options":[],"createdAt":4,"undoable":false}],
            "held":[{"id":"l1","fromName":"周报","toSession":"s","kind":"request","summary":"x","body":"y","status":"held","createdAt":5}]}""",
        ))
        assertEquals(5, center.count)
        assertEquals(setOf("approval:a1", "approval:a2", "approval:a3", "card:c1", "letter:l1"), center.keys)
        val (permission, plain, asked) = center.approvals
        assertEquals("git push", permission.line)
        assertTrue(permission.canRemember)
        assertEquals(listOf("甲", "乙"), plain.questions.single().options.map { it.label })
        assertEquals("说明", plain.questions.single().options[1].detail)
        assertTrue(asked.questions.single().multiple)
        assertEquals(false, center.cards.single().undoable)
        assertNull(ApprovalItem.from(json("""{"sessionId":"s"}""")))
    }

    @Test
    fun notificationIsPutIntoWordsAsTheComputerMeansIt() {
        val text = { id: Int -> "<$id>" }
        val count = { id: Int, n: Int -> "<$id:$n>" }
        val permission = checkNotNull(Note.parse("""{"v":1,"id":"n1","kind":"permission","title":"官网","body":"git push","badge":2}"""))
        val words = NoteText(permission, text, count)
        assertEquals("官网", words.title)
        assertEquals("<${R.string.push_permission}><${R.string.push_separator}>git push", words.body)
        assertNull(permission.clear)
        assertNull(permission.session)

        val many = NoteText(checkNotNull(Note.parse("""{"v":1,"id":"n2","kind":"many","title":"","body":"","n":3,"badge":3}""")), text, count)
        assertEquals("Jig", many.title)
        assertEquals("<${R.plurals.push_many}:3>", many.body)

        val failed = checkNotNull(Note.parse("""{"v":1,"id":"n3","kind":"task","title":"周报","body":"","session":"s1","code":"failed","badge":0}"""))
        assertEquals("<${R.string.push_task_failed}>", NoteText(failed, text, count).body)
        assertEquals("s1", failed.session)

        val clear = checkNotNull(Note.parse("""{"v":1,"clear":["n1","n2"],"badge":0}"""))
        assertEquals(listOf("n1", "n2"), clear.clear)
        assertNull(Note.parse("not json"))
    }

    @Test
    fun inlineMarkdownIsCutInOnePass() {
        val pieces = inlinePieces("改了 `auth/session.ts`，**48 个**测试通过，见 [说明](https://example.com/a)。`没闭合 和 **也没闭合 [不是链接](ftp://x)")
        assertEquals(
            listOf(
                InlineKind.Plain to "改了 ", InlineKind.Code to "auth/session.ts", InlineKind.Plain to "，",
                InlineKind.Bold to "48 个", InlineKind.Plain to "测试通过，见 ", InlineKind.Link to "说明",
                InlineKind.Plain to "。`没闭合 和 **也没闭合 [不是链接](ftp://x)",
            ),
            pieces.map { it.kind to it.text },
        )
        assertEquals("https://example.com/a", pieces[5].url)
        // A long answer full of marks that never close: cutting it must not take longer per character.
        val long = "`开头一个没闭合的，**也是，" + "一段很长的回复，带着 [ 和 * 的文字。".repeat(40_000)
        val started = System.nanoTime()
        assertEquals(long, inlinePieces(long).joinToString("") { it.text })
        assertTrue((System.nanoTime() - started) / 1_000_000 < 3_000)
    }

    // The packed bytes come from the computer's own code: zlib.deflateRawSync of the JSON, then base64.
    @Test
    fun packedAnswerFromTheComputerIsUnpacked() {
        val packed = "fdQ7asMAEIThq4StXWRm/FSbYwQXhqgwyA5YEgSML2LIGXyBHCdFjhGlSDViumX5u4/dax2H9tRX83qt41s11T/Xos6HUzvN31/3n8fn09+mHw7DOGVT1LV1W/zXsBqhptUMtaxWqJdWL0O9snoV6rXV61BvrN6Eemv1NtQ7q3dJxzERNWc4kyccFEkUTopkCkdFUoWzIrnCYZFk4bRItnBcJF04L5Iv3ZfJl+7LeK8zB5t86b5MvnRfJl+6L5Mv3ZfJl+7L5Ev3ZfKl+zL5yn2VfOW+Sr5yX8WPPPOSk6/cV8lX7qvkK/dV8pX7KvnKfZV85b6a8d1PUfsxvIyX/v1SzXnsutsv"
        val text = unpackBody(packed, packed = true)
        assertEquals(1769, text.length)
        val items = json(text).getValue("items") as kotlinx.serialization.json.JsonArray
        assertEquals(40, items.size)
        assertTrue(text.contains("会话 39"))
        assertEquals("plain", unpackBody("plain", packed = false))
        assertThrows(IOException::class.java) { unpackBody(packed.dropLast(12), packed = true) }
        assertThrows(IOException::class.java) { unpackBody("not base64 !!", packed = true) }
    }
}
