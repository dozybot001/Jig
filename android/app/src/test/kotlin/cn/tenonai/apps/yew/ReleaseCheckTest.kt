package cn.tenonai.apps.yew

import cn.tenonai.apps.yew.update.ReleaseCheck
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseCheckTest {
    @Test
    fun comparesVersionsByNumber() {
        assertTrue(ReleaseCheck.isNewer("1.8.0", "1.7.0"))
        assertTrue(ReleaseCheck.isNewer("1.10.0", "1.9.9"))
        assertFalse(ReleaseCheck.isNewer("1.7.0", "1.7.0"))
        assertFalse(ReleaseCheck.isNewer("1.6.1", "1.7.0"))
    }

    @Test
    fun readsTheTagOfGiteesAnswer() {
        assertEquals("1.8.0", ReleaseCheck.latestVersion("""{"tag_name":"v1.8.0","name":"1.8.0"}"""))
        assertNull(ReleaseCheck.latestVersion("""{"tag_name":"nightly"}"""))
        assertNull(ReleaseCheck.latestVersion("not json"))
        assertEquals("https://gitee.com/dozybot/yew/releases/tag/v1.8.0", ReleaseCheck.page("1.8.0"))
    }
}
