package cn.tenonai.apps.yew.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cn.tenonai.apps.yew.AppModel
import cn.tenonai.apps.yew.Page
import cn.tenonai.apps.yew.R
import cn.tenonai.apps.yew.api.LetterItem
import java.text.DateFormat
import java.util.Date

/** What became of a letter, when it did not simply arrive. */
@Composable
private fun letterStatus(status: String): String? = when (status) {
    "held" -> stringResource(R.string.letter_held)
    "refused" -> stringResource(R.string.letter_refused)
    "dropped" -> stringResource(R.string.letter_dropped)
    else -> null
}

/** Every letter between sessions, newest first, one line each; tap one to read it whole. */
@Composable
fun LettersList(model: AppModel) {
    Refreshable(model, { model.refreshLetters() }) {
        LazyColumn(Modifier.fillMaxSize()) {
            items(model.letters, key = { it.id }) { letter ->
                Column(
                    Modifier.fillMaxWidth().clickable { model.pages.add(Page.Letter(letter)) }.padding(16.dp, 10.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(
                        "${senderName(letter.fromKind, letter.fromName)} → ${model.name(letter.toSession)}",
                        color = colors.soft, style = MaterialTheme.typography.bodySmall,
                    )
                    Text(letter.summary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    letterStatus(letter.status)?.let { Text(it, color = colors.soft, style = MaterialTheme.typography.bodySmall) }
                }
            }
            if (model.loaded && model.letters.isEmpty()) {
                item { Box(Modifier.fillParentMaxSize()) { Empty(Icons.Letters, stringResource(R.string.letters_empty)) } }
            }
        }
    }
}

/** One letter in full: who wrote to whom, what kind, when, and its text. */
@Composable
fun LetterScreen(model: AppModel, letter: LetterItem, close: () -> Unit) {
    Screen(title = letter.summary, onBack = close) { padding ->
        SelectionContainer {
            Column(
                Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val small = MaterialTheme.typography.bodySmall
                Text(letterLine(senderName(letter.fromKind, letter.fromName), letter.kind), color = colors.soft, style = small)
                val date = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(letter.createdAt.toLong()))
                Text(stringResource(R.string.letter_to, model.name(letter.toSession), date), color = colors.soft, style = small)
                letterStatus(letter.status)?.let { Text(it, color = colors.soft, style = small) }
                Text(letter.body)
            }
        }
    }
}
