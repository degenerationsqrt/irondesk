package app.irondesk.mobile.preview

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val IronDeskColors = darkColorScheme(
    primary = Color(0xFF4BA3FF),
    onPrimary = Color(0xFF04131F),
    secondary = Color(0xFF42D392),
    background = Color(0xFF0B0E13),
    onBackground = Color(0xFFF4F7FB),
    surface = Color(0xFF131923),
    onSurface = Color(0xFFF4F7FB),
    surfaceVariant = Color(0xFF1B2431),
    onSurfaceVariant = Color(0xFFAEB9C8),
    error = Color(0xFFFF6B6B),
)

@Composable
fun IronDeskPreviewTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = IronDeskColors, content = content)
}
