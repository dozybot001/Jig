package cn.tenonai.apps.yew.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** Yew's own line icons, drawn on a 24 by 24 grid; the app carries no icon library. */
object Icons {
    private fun icon(name: String, vararg strokes: String, fills: List<String> = emptyList()): ImageVector {
        val builder = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
        for (path in strokes) {
            builder.addPath(
                pathData = addPathNodes(path), stroke = SolidColor(Color.Black), strokeLineWidth = 1.7f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
            )
        }
        for (path in fills) builder.addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black))
        return builder.build()
    }

    private const val CIRCLE = "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18Z"

    val Sessions = icon("sessions", "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-4 3.5V17a2 2 0 0 1-2-2Z")
    val Approvals = icon("approvals", CIRCLE, "M8 12.5l2.8 2.8L16 9.5")
    val Letters = icon("letters", "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z", "M3.5 7.5L12 13l8.5-5.5")
    val Artifacts = icon("artifacts", "M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M14 3v4h4", "M9 12h6", "M9 16h6")
    val Settings = icon(
        "settings", "M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z", "M12 5.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13Z",
        "M18.5 12H21", "M16.6 16.6l1.76 1.76", "M12 18.5V21", "M7.4 16.6l-1.76 1.76", "M5.5 12H3",
        "M7.4 7.4L5.64 5.64", "M12 5.5V3", "M16.6 7.4l1.76-1.76",
    )
    val Chat = icon("chat", "M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4 3.5V16a2 2 0 0 1-2-2Z")
    val Code = icon("code", "M9 8l-4 4l4 4", "M15 8l4 4l-4 4")
    val Pin = icon("pin", "M12 16v5", "M8.5 4h7l-1 6l3 3.5v2.5h-11v-2.5l3-3.5Z")
    val Tools = icon("tools", "M14.5 6a4 4 0 0 0-4.6 5.2L4.5 16.6a2 2 0 0 0 2.9 2.9l5.4-5.4A4 4 0 0 0 18 9.5l-2.5 2.5l-2.5-1l-1-2.5Z")
    val Back = icon("back", "M15 5l-7 7l7 7")
    val Forward = icon("forward", "M9 5l7 7l-7 7")
    val Up = icon("up", "M12 18V6", "M7 11l5-5l5 5")
    val Stop = icon("stop", fills = listOf("M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"))
    val Qr = icon(
        "qr", "M4 4h6v6H4Z", "M14 4h6v6h-6Z", "M4 14h6v6H4Z", "M14 14h2v2h-2Z", "M18.5 14.5v0.01", "M14.5 19.5v0.01",
        "M18 18h2v2h-2Z",
    )
    val Check = icon("check", "M5 12.5l4.5 4.5L19 7.5")
    val Block = icon("block", CIRCLE, "M5.8 5.8l12.4 12.4")
    val RadioOff = icon("radio-off", "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16Z")
    val RadioOn = icon("radio-on", "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16Z", fills = listOf("M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8Z"))
    val BoxOff = icon("box-off", "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z")
    val BoxOn = icon("box-on", "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "M8 12.5l2.8 2.8L16 9.5")
    val Dots = icon("dots", fills = listOf("M6 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3Z", "M12 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3Z", "M18 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 0 0 0-3Z"))
}
