package com.shyden.shytalk.feature.home

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

@Composable
fun CreateRoomDialog(
    onDismiss: () -> Unit,
    onCreate: (String) -> Unit,
    initialRoomName: String = "",
) {
    var roomName by remember { mutableStateOf(initialRoomName) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.create_room)) },
        text = {
            Column {
                Text(stringResource(Res.string.create_room_prompt))
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = roomName,
                    onValueChange = { if (it.length <= 50) roomName = it },
                    label = { Text(stringResource(Res.string.room_name_label)) },
                    modifier = Modifier.fillMaxWidth().testTag("createRoom_nameField"),
                    singleLine = true,
                )
            }
        },
        confirmButton = {
            // Tag aligned with corpus naming (j09:24, j15:25, j16:53).
            // Renamed from createRoom_createButton → createRoom_confirmButton.
            TextButton(
                onClick = { onCreate(roomName) },
                enabled = roomName.isNotBlank(),
                modifier = Modifier.testTag("createRoom_confirmButton"),
            ) {
                Text(stringResource(Res.string.create))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(Res.string.cancel))
            }
        },
    )
}
