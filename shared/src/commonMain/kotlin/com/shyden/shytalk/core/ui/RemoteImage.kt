package com.shyden.shytalk.core.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
 * own bounds, which reads as "nothing here yet" rather than as an error.
 *
 * A caller with something better to show — the gift wall's initials circle, an
 * avatar's person icon — cannot express it as a [Painter], because those are
 * composables. Those callers use [RemoteImageWithFallback] instead.
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

/**
 * Drawn nothing. Lets whatever sits behind the image show through.
 *
 * Distinct from simply passing `null`, which [RemoteImage] reads as "use the
 * quiet default" — an opaque tint that would hide the fallback underneath.
 */
private val Nothing: Painter = ColorPainter(Color.Transparent)

/**
 * A remote image drawn OVER the screen's own answer to "there is no picture".
 *
 * SHY-0444. Eight screens already had a good empty state — the gift wall's
 * tinted initials circle, [UserAvatar]'s person icon — reached through
 * `if (iconUrl.isNotBlank())`. All eight left the FAILED-load case to
 * [RemoteImage]'s generic tint, so a gift with no icon and a gift whose icon
 * 404'd looked like two different things. To the person holding the phone they
 * are the same thing.
 *
 * The obvious fix — pass the initials circle as [RemoteImage]'s `error` — is
 * not available: that slot is a [Painter] and these fallbacks are composables.
 * Re-drawing each one as a painter would mean two implementations of the same
 * circle, kept in step by hand.
 *
 * So the fallback is composed UNDERNEATH and the image is transparent whenever
 * it has nothing to show. Empty URL, dead URL, CDN outage and slow connection
 * all reveal the same thing, and they cannot drift apart because there is only
 * one of them. When the image arrives it simply covers it.
 *
 * [modifier] goes on the enclosing box, so a `.clip(CircleShape)` or `.size()`
 * shapes the fallback and the image alike — another way the two states cannot
 * diverge.
 */
@Composable
fun RemoteImageWithFallback(
    model: Any?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Fit,
    alpha: Float = DefaultAlpha,
    fallback: @Composable () -> Unit,
) {
    // A blank URL is not a request worth making. Handing Coil null sends it
    // straight to its `fallback` slot, which is transparent here — so an empty
    // URL and a dead one take the same path, rather than two paths that agree.
    val request = if (model is String && model.isBlank()) null else model
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        fallback()
        AsyncImage(
            model = request,
            contentDescription = contentDescription,
            modifier = Modifier.matchParentSize(),
            contentScale = contentScale,
            error = Nothing,
            placeholder = Nothing,
            fallback = Nothing,
            alpha = alpha,
        )
    }
}
