package cn.tenonai.apps.jig

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The app's privacy policy and terms are the computer's (src/shared/policy.ts), in both languages.
 * After the text changes there, `node android/scripts/sync-policy.ts` brings the app's copy up to date.
 */
class PolicyTest {
    private val root = File(checkNotNull(System.getProperty("jig.root")))
    private val source = File(root, "src/shared/policy.ts").readText()

    private fun unescape(text: String) = text
        .replace("\\'", "'").replace("\\\"", "\"").replace("\\@", "@").replace("\\?", "?").replace("\\\\", "\\")
        .replace("&lt;", "<").replace("&amp;", "&")

    private fun items(xml: String, name: String): List<String> {
        val block = checkNotNull(Regex("""<string-array name="$name">(.*?)</string-array>""", RegexOption.DOT_MATCHES_ALL).find(xml))
        return Regex("<item>(.*?)</item>", RegexOption.DOT_MATCHES_ALL).findAll(block.groupValues[1]).map { unescape(it.groupValues[1]) }.toList()
    }

    private fun string(xml: String, name: String) =
        unescape(checkNotNull(Regex("""<string name="$name"[^>]*>(.*?)</string>""").find(xml)).groupValues[1])

    /** The paragraphs of one language in policy.ts: the quoted lines between `name: [` and `]`. */
    private fun paragraphs(language: String, name: String): List<String> {
        val start = source.indexOf("\t$language: {")
        val from = source.indexOf("$name: [", start)
        val block = source.substring(from, source.indexOf("],", from))
        return Regex("""^\s*"(.*)",$""", RegexOption.MULTILINE).findAll(block).map { it.groupValues[1] }.toList()
    }

    @Test
    fun theTextIsTheComputersInBothLanguages() {
        val version = checkNotNull(Regex("""POLICY_VERSION = "([^"]+)"""").find(source)).groupValues[1]
        for ((folder, language) in listOf("values" to "en", "values-zh-rCN" to "zh")) {
            val xml = File(root, "android/app/src/main/res/$folder/policy.xml").readText()
            if (language == "en") assertEquals(version, string(xml, "policy_version"))
            assertTrue(source.contains("date: \"${string(xml, "policy_date")}\""))
            val privacy = paragraphs(language, "privacy")
            assertTrue(privacy.size >= 5)
            assertEquals(privacy, items(xml, "policy_privacy"))
            assertEquals(paragraphs(language, "terms"), items(xml, "policy_terms"))
        }
    }
}
