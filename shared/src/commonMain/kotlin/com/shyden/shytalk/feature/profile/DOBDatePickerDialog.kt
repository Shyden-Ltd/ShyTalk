package com.shyden.shytalk.feature.profile

import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.isAtLeast13
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import org.jetbrains.compose.resources.stringResource
import kotlin.time.Instant

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DOBDatePickerDialog(
    onDismiss: () -> Unit,
    onDateSelected: (millis: Long, error: String?) -> Unit,
) {
    val currentYear = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(TimeZone.currentSystemDefault()).year
    val datePickerState =
        rememberDatePickerState(
            yearRange = 1940..(currentYear - 13),
        )
    val ageErrorMsg = stringResource(Res.string.must_be_13)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    onDismiss()
                    val millis = datePickerState.selectedDateMillis
                    if (millis != null) {
                        val error = if (!isAtLeast13(millis)) ageErrorMsg else null
                        onDateSelected(millis, error)
                    }
                },
            ) {
                Text(stringResource(Res.string.ok))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(Res.string.cancel))
            }
        },
    ) {
        DatePicker(state = datePickerState)
    }
}
