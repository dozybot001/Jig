package cn.tenonai.apps.jig.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Jig's colours: black, white and grey, as on the computer (web/src/styles/app.css), light or dark
 * with the system. Text on its background is at least 4.5:1; the marks that carry a state are 3:1.
 */
class JigColors(
    val paper: Color,
    val ink: Color,
    /** Secondary text. */
    val soft: Color,
    /** The fill of a message of your own and of text fields. */
    val bubble: Color,
    /** The main button: a soft grey fill, never white in the dark. */
    val primary: Color,
    val onPrimary: Color,
    /** Outlines of buttons, cards and tags. */
    val control: Color,
    val danger: Color,
    /** The dot of a session that waits for you. */
    val waiting: Color,
)

private val Light = JigColors(
    paper = Color(0xFFFFFFFF), ink = Color(0xFF0D0D0D), soft = Color(0xFF666666), bubble = Color(0xFFF2F2F2),
    primary = Color(0xFFE6E6E6), onPrimary = Color(0xFF0D0D0D), control = Color(0xFFDCDCDC),
    danger = Color(0xFFC62828), waiting = Color(0xFFD9540B),
)

private val Dark = JigColors(
    paper = Color(0xFF121212), ink = Color(0xFFECECEC), soft = Color(0xFFA3A3A3), bubble = Color(0xFF1F1F1F),
    primary = Color(0xFF383838), onPrimary = Color(0xFFF2F2F2), control = Color(0xFF363636),
    danger = Color(0xFFFF6B6B), waiting = Color(0xFFFF922B),
)

val LocalJigColors = staticCompositionLocalOf { Light }

val colors: JigColors
    @Composable get() = LocalJigColors.current

@Composable
fun JigTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val jig = if (dark) Dark else Light
    val scheme = if (dark) {
        darkColorScheme(
            primary = jig.ink, onPrimary = jig.paper, background = jig.paper, onBackground = jig.ink,
            surface = jig.paper, onSurface = jig.ink, onSurfaceVariant = jig.soft, surfaceVariant = jig.bubble,
            surfaceContainer = jig.paper, surfaceContainerHigh = jig.bubble, surfaceContainerHighest = jig.bubble,
            secondaryContainer = jig.primary, onSecondaryContainer = jig.onPrimary, outline = jig.soft,
            outlineVariant = jig.control, error = jig.danger,
        )
    } else {
        lightColorScheme(
            primary = jig.ink, onPrimary = jig.paper, background = jig.paper, onBackground = jig.ink,
            surface = jig.paper, onSurface = jig.ink, onSurfaceVariant = jig.soft, surfaceVariant = jig.bubble,
            surfaceContainer = jig.paper, surfaceContainerHigh = jig.bubble, surfaceContainerHighest = jig.bubble,
            secondaryContainer = jig.primary, onSecondaryContainer = jig.onPrimary, outline = jig.soft,
            outlineVariant = jig.control, error = jig.danger,
        )
    }
    CompositionLocalProvider(LocalJigColors provides jig) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
