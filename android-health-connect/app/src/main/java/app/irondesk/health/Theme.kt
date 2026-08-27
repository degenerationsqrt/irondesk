package app.irondesk.health

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * IronDesk's visual language, ported to Compose: near-black surfaces, electric
 * blue accent, condensed upper-case headings, amber for caution and red for
 * failure. Always dark — the web app has no light theme either.
 */
object IronDesk {
    val Background = Color(0xFF07090C)
    val Surface = Color(0xFF0E1319)
    val SurfaceHigh = Color(0xFF151C24)
    val Border = Color(0xFF232C36)
    val Blue = Color(0xFF2F7BFF)
    val BlueDim = Color(0xFF15263F)
    val Green = Color(0xFF34D399)
    val Amber = Color(0xFFFBBF24)
    val Red = Color(0xFFF87171)
    val Text = Color(0xFFE7EEF7)
    val Muted = Color(0xFF8A97A6)

    val CardRadius = 16.dp
}

private val condensed = FontFamily.SansSerif

private val typography = Typography(
    displaySmall = TextStyle(
        fontFamily = condensed,
        fontWeight = FontWeight.Black,
        fontSize = 30.sp,
        letterSpacing = 1.2.sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = condensed,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 22.sp,
        letterSpacing = 0.8.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = condensed,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
        letterSpacing = 1.6.sp,
    ),
    bodyMedium = TextStyle(fontFamily = condensed, fontSize = 15.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontFamily = condensed, fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(
        fontFamily = condensed,
        fontWeight = FontWeight.Bold,
        fontSize = 14.sp,
        letterSpacing = 0.8.sp,
    ),
)

@Composable
fun IronDeskTheme(content: @Composable () -> Unit) {
    // isSystemInDarkTheme is read only so the call site stays honest about the
    // choice: IronDesk is dark in both cases.
    @Suppress("UNUSED_VARIABLE") val ignored = isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = IronDesk.Blue,
            onPrimary = Color.White,
            primaryContainer = IronDesk.BlueDim,
            background = IronDesk.Background,
            onBackground = IronDesk.Text,
            surface = IronDesk.Surface,
            onSurface = IronDesk.Text,
            surfaceVariant = IronDesk.SurfaceHigh,
            onSurfaceVariant = IronDesk.Muted,
            outline = IronDesk.Border,
            error = IronDesk.Red,
        ),
        typography = typography,
        content = content,
    )
}
