package cn.tenonai.apps.jig.api

enum class InlineKind { Plain, Code, Bold, Link }

class InlinePiece(val kind: InlineKind, val text: String, val url: String? = null)

// The lengths are bounded so that a "[" in a long text without line breaks is not searched to its end.
private val LINK = Regex("""\[([^\]\n]{1,300})]\((https?://[^)\s]{1,2000})\)""")

/**
 * Cuts a text into plain runs, `code`, **bold** and [links](https://…), in one pass: the time it
 * takes grows with the length of the text, however long an answer is. A mark that is never closed
 * stays as written.
 */
fun inlinePieces(text: String): List<InlinePiece> {
    val pieces = mutableListOf<InlinePiece>()
    val plain = StringBuilder()
    fun flush() {
        if (plain.isNotEmpty()) pieces.add(InlinePiece(InlineKind.Plain, plain.toString()))
        plain.setLength(0)
    }
    // Once a closing mark is not found from some point on, none is there further on either.
    var noCode = false
    var noBold = false
    var i = 0
    while (i < text.length) {
        val c = text[i]
        if (c == '`' && !noCode) {
            val end = text.indexOf('`', i + 1)
            if (end < 0) noCode = true
            if (end > i + 1) {
                flush()
                pieces.add(InlinePiece(InlineKind.Code, text.substring(i + 1, end)))
                i = end + 1
                continue
            }
        } else if (c == '*' && !noBold && text.startsWith("**", i)) {
            val end = text.indexOf("**", i + 2)
            if (end < 0) noBold = true
            if (end > i + 2) {
                flush()
                pieces.add(InlinePiece(InlineKind.Bold, text.substring(i + 2, end)))
                i = end + 2
                continue
            }
        } else if (c == '[') {
            val match = LINK.matchAt(text, i)
            if (match != null) {
                flush()
                pieces.add(InlinePiece(InlineKind.Link, match.groupValues[1], match.groupValues[2]))
                i = match.range.last + 1
                continue
            }
        }
        plain.append(c)
        i += 1
    }
    flush()
    return pieces
}
