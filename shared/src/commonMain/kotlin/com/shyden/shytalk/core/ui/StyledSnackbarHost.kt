package com.shyden.shytalk.core.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
fun StyledSnackbarHost(hostState: SnackbarHostState) {
    SnackbarHost(hostState) { data ->
        Snackbar(
            // Every toast in the app comes through here, so one tag makes them
            // all findable. Driver assertions previously looked for
            // `toastWithRoute_`, which the product has never rendered — so
            // "shows a toast and navigates" could only ever fail.
            //
            // The message itself stays in the snackbar's own text, which is what
            // an assertion should check: a toast is only correct if it says the
            // right thing.
            modifier = Modifier.testTag("app_toast"),
            snackbarData = data,
            containerColor = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
            actionColor = MaterialTheme.colorScheme.error,
            shape = RoundedCornerShape(12.dp),
        )
    }
}
