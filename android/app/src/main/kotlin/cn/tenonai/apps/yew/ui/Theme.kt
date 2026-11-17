package cn.tenonai.apps.yew.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Yew's colours: black, white and grey, as on the computer (web/src/styles/app.css), light or dark
 * with the system; only the mark (its mark_ink is in the themes.xml files) and the mascot add colour.
 * Text on its background is at least 4.5:1; the marks that carry a state are 3:1.
 */
class YewColors(
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

private val Light = YewColors(
    paper = Color(0xFFFFFFFF), ink = Color(0xFF0D0D0D), soft = Color(0xFF666666), bubble = Color(0xFFF2F2F2),
    primary = Color(0xFFE6E6E6), onPrimary = Color(0xFF0D0D0D), control = Color(0xFFDCDCDC),
    danger = Color(0xFFC62828), waiting = Color(0xFFD9540B),
)

private val Dark = YewColors(
    paper = Color(0xFF121212), ink = Color(0xFFECECEC), soft = Color(0xFFA3A3A3), bubble = Color(0xFF1F1F1F),
    primary = Color(0xFF383838), onPrimary = Color(0xFFF2F2F2), control = Color(0xFF363636),
    danger = Color(0xFFFF6B6B), waiting = Color(0xFFFF922B),
)

val LocalYewColors = staticCompositionLocalOf { Light }

val colors: YewColors
    @Composable get() = LocalYewColors.current

@Composable
fun YewTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val palette = if (dark) Dark else Light
    val scheme = if (dark) {
        darkColorScheme(
            primary = palette.ink, onPrimary = palette.paper, background = palette.paper, onBackground = palette.ink,
            surface = palette.paper, onSurface = palette.ink, onSurfaceVariant = palette.soft, surfaceVariant = palette.bubble,
            surfaceContainer = palette.paper, surfaceContainerHigh = palette.bubble, surfaceContainerHighest = palette.bubble,
            secondaryContainer = palette.primary, onSecondaryContainer = palette.onPrimary, outline = palette.soft,
            outlineVariant = palette.control, error = palette.danger,
        )
    } else {
        lightColorScheme(
            primary = palette.ink, onPrimary = palette.paper, background = palette.paper, onBackground = palette.ink,
            surface = palette.paper, onSurface = palette.ink, onSurfaceVariant = palette.soft, surfaceVariant = palette.bubble,
            surfaceContainer = palette.paper, surfaceContainerHigh = palette.bubble, surfaceContainerHighest = palette.bubble,
            secondaryContainer = palette.primary, onSecondaryContainer = palette.onPrimary, outline = palette.soft,
            outlineVariant = palette.control, error = palette.danger,
        )
    }
    CompositionLocalProvider(LocalYewColors provides palette) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
