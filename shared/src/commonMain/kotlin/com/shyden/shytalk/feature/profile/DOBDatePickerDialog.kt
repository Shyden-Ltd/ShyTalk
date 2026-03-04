package com.shyden.shytalk.feature.profile

import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.isAtLeast13
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DOBDatePickerDialog(
    onDismiss: () -> Unit,
    onDateSelected: (millis: Long, error: String?) -> Unit
) {
    val currentYear = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(TimeZone.currentSystemDefault()).year
    val datePickerState = rememberDatePickerState(
        yearRange = 1940..(currentYear - 13),
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    onDismiss()
                    val millis = datePickerState.selectedDateMillis
                    if (millis != null) {
                        val error = if (!isAtLeast13(millis)) {
                            "You must be at least 13 years old"
                        } else {
                            null
                        }
                        onDateSelected(millis, error)
                    }
                }
            ) {
                Text("OK")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    ) {
        DatePicker(state = datePickerState)
    }
}
