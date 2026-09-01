package com.shyden.shytalk.core.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Somebody's picture, or the same considered stand-in everywhere when there
 * isn't one.
 *
 * SHY-0444. This exact shape — null-check the URL, draw the image, else draw a
 * tinted circle with a person icon — was written out by hand in several
 * screens, and SonarCloud flagged two copies of it inside a single file. Each
 * copy is a place where the fallback can drift: a different size, a different
 * tint, or none at all.
 *
 * The failure state matters as much as the empty one. A person with a picture
 * that will not load and a person with no picture look identical to whoever is
 * holding the phone, so they look identical here: [RemoteImage] draws this same
 * circle when the load fails.
 */
@Composable
fun UserAvatar(
    photoUrl: String?,
    displayName: String?,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    iconPadding: Dp = 12.dp,
) {
    if (photoUrl.isNullOrBlank()) {
        AvatarFallback(modifier = modifier, size = size, iconPadding = iconPadding)
        return
    }
    RemoteImage(
        model = photoUrl,
        contentDescription = displayName,
        modifier = modifier.size(size).clip(CircleShape),
        contentScale = ContentScale.Crop,
    )
}

@Composable
private fun AvatarFallback(
    modifier: Modifier,
    size: Dp,
    iconPadding: Dp,
) {
    Surface(
        modifier = modifier.size(size),
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primaryContainer,
    ) {
        Icon(
            Icons.Default.Person,
            contentDescription = null,
            modifier = Modifier.padding(iconPadding),
            tint = MaterialTheme.colorScheme.onPrimaryContainer,
        )
    }
}
