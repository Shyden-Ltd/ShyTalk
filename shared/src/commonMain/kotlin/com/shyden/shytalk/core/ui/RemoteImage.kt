package com.shyden.shytalk.core.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.DefaultAlpha
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import coil3.compose.AsyncImage

/**
 * A remote image with a failure state somebody chose.
 *
 * SHY-0444. `AsyncImage` was called in 41 places and **not one** passed
 * `error`, `placeholder` or `fallback` — so every remote image in the app
 * (avatars, gift art, room covers, message attachments, banners) fell through
 * to Coil's own broken-image state on a dead URL, a CDN outage, a local stack
 * with no object storage, or simply a patchy connection.
 *
 * That last one is the point: this is not an edge case on a developer's desk,
 * it is what a person on a train sees.
 *
 * The app already had a good answer for "there is no picture" — GiftWallScreen
 * draws a tinted circle with the gift's initials when `iconUrl` is blank — and
 * no answer at all for "the picture did not arrive". Those two look identical
 * to the person holding the phone and should look identical on screen.
 *
 * The default here is deliberately quiet: a filled surface tint in the image's
 * own bounds, which reads as "nothing here yet" rather than as an error. A
 * caller with something better to show passes [error] — the gift wall passes
 * its initials circle.
 */
@Composable
fun RemoteImage(
    model: Any?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Fit,
    error: Painter? = null,
    placeholder: Painter? = null,
    alpha: Float = DefaultAlpha,
) {
    // Same painter for both states on purpose. A picture that is loading and a
    // picture that failed are the same to look at, and a distinct "loading"
    // treatment that flashes on every fast load is worse than none.
    val quiet: Painter = ColorPainter(MaterialTheme.colorScheme.surfaceVariant)
    AsyncImage(
        model = model,
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = contentScale,
        error = error ?: quiet,
        placeholder = placeholder ?: quiet,
        fallback = error ?: quiet,
        alpha = alpha,
    )
}
