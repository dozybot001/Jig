package cn.tenonai.apps.jig.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import cn.tenonai.apps.jig.AppModel
import cn.tenonai.apps.jig.Page
import cn.tenonai.apps.jig.R
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import java.util.concurrent.Executors

/** The first screen: what Jig is, and how this phone connects to Jig on the person's computer. */
@Composable
fun ConnectScreen(model: AppModel) {
    val context = LocalContext.current
    var link by rememberSaveable { mutableStateOf("") }
    val hasCamera = remember { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState())
            .padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        JigMark(56.dp)
        Spacer(Modifier.height(12.dp))
        Text("Jig", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Text(
            stringResource(R.string.tagline), color = colors.soft, textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
        Spacer(Modifier.height(28.dp))

        if (hasCamera) {
            CapsuleButton(
                stringResource(R.string.connect_scan), onClick = { model.pages.add(Page.Scanner) },
                icon = Icons.Qr, enabled = !model.pairing,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
        }
        Footnote(stringResource(R.string.connect_scan_help))

        SectionTitle(stringResource(R.string.connect_paste_title))
        GrowingField(
            link, { link = it }, stringResource(R.string.connect_paste_hint), plain = true, maxLines = 4,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        Spacer(Modifier.height(8.dp))
        CapsuleButton(
            stringResource(R.string.pair), onClick = { model.startPairing(link) },
            kind = ButtonKind.Secondary, enabled = link.isNotBlank(), busy = model.pairing,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        model.problem?.let {
            Text(it, color = colors.danger, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp))
        }

        Spacer(Modifier.height(20.dp))
        CapsuleButton(
            stringResource(R.string.demo_try), onClick = { model.startDemo() },
            kind = ButtonKind.Secondary, enabled = !model.pairing,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        Footnote(stringResource(R.string.demo_help))

        Spacer(Modifier.height(16.dp))
        Group { GroupRow(stringResource(R.string.about), onClick = { model.pages.add(Page.About) }) }
    }
}

/** The camera, looking for Jig's pairing QR code; pairs with the first one it sees. */
@Composable
fun ScannerScreen(model: AppModel, close: () -> Unit) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var refused by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        refused = !it
    }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }

    Screen(stringResource(R.string.scan_title), onBack = close) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (granted) {
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    CameraPreview { code ->
                        close()
                        model.startPairing(code)
                    }
                }
                Text(
                    stringResource(R.string.scan_hint), color = colors.soft, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                )
            } else if (refused) {
                Column(
                    Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(stringResource(R.string.camera_denied), textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(16.dp))
                    CapsuleButton(stringResource(R.string.open_system_settings), kind = ButtonKind.Secondary, onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
                        )
                    })
                }
            }
        }
    }
}

@Composable
private fun CameraPreview(onCode: (String) -> Unit) {
    val activity = LocalContext.current as ComponentActivity
    val executor = remember { Executors.newSingleThreadExecutor() }
    val view = remember { PreviewView(activity) }
    DisposableEffect(Unit) {
        val providers = ProcessCameraProvider.getInstance(activity)
        var done = false
        providers.addListener({
            val provider = providers.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(executor) { image ->
                val code = image.use(::readQr)
                if (code != null && code.startsWith("jig://pair?")) {
                    activity.runOnUiThread {
                        if (!done) {
                            done = true
                            onCode(code)
                        }
                    }
                }
            }
            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(activity, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }
        }, activity.mainExecutor)
        onDispose {
            runCatching { providers.get().unbindAll() }
            executor.shutdown()
        }
    }
    AndroidView({ view }, Modifier.fillMaxSize())
}

private val qrHints = mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true)

/** The text of a QR code in this camera frame, dark on light or light on dark; null when there is none. */
private fun readQr(image: ImageProxy): String? {
    val plane = image.planes[0]
    val bytes = ByteArray(plane.buffer.remaining()).also { plane.buffer.get(it) }
    val source = PlanarYUVLuminanceSource(bytes, plane.rowStride, image.height, 0, 0, image.width, image.height, false)
    for (candidate in listOf(source, source.invert())) {
        try {
            return QRCodeReader().decode(BinaryBitmap(HybridBinarizer(candidate)), qrHints).text
        } catch (_: ReaderException) {
            // No code in this frame.
        }
    }
    return null
}
