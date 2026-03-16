package com.shyden.shytalk.feature.home

import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest

data class BannerItem(
    val key: String,
    val onClick: (() -> Unit)? = null,
    val content: @Composable () -> Unit,
)

private const val AUTO_SCROLL_DELAY = 5000L

@Composable
fun BannerCarousel(
    banners: List<BannerItem>,
    modifier: Modifier = Modifier,
) {
    if (banners.isEmpty()) return

    val pagerState = rememberPagerState(pageCount = { banners.size })

    // Auto-scroll when there are multiple banners
    if (banners.size > 1) {
        AutoScrollEffect(pagerState, banners.size)
    }

    Box(modifier = modifier) {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxWidth(),
        ) { page ->
            val item = banners[page]
            val clickModifier = item.onClick?.let { Modifier.clickable(onClick = it) } ?: Modifier
            Box(modifier = clickModifier) {
                item.content()
            }
        }

        if (banners.size > 1) {
            PageIndicator(
                pageCount = banners.size,
                currentPage = pagerState.currentPage,
                modifier =
                    Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 8.dp),
            )
        }
    }
}

@Composable
private fun AutoScrollEffect(
    pagerState: PagerState,
    pageCount: Int,
) {
    LaunchedEffect(pagerState) {
        snapshotFlow { pagerState.isScrollInProgress }
            .collectLatest { isScrolling ->
                if (!isScrolling) {
                    while (true) {
                        delay(AUTO_SCROLL_DELAY)
                        val nextPage = (pagerState.currentPage + 1) % pageCount
                        pagerState.animateScrollToPage(nextPage, animationSpec = tween(500))
                    }
                }
            }
    }
}

@Composable
private fun PageIndicator(
    pageCount: Int,
    currentPage: Int,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        repeat(pageCount) { index ->
            Box(
                modifier =
                    Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(
                            if (index == currentPage) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
                            },
                        ),
            )
        }
    }
}
