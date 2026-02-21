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

@Composable
fun CreateRoomDialog(
    onDismiss: () -> Unit,
    onCreate: (String) -> Unit,
    initialRoomName: String = ""
) {
    var roomName by remember { mutableStateOf(initialRoomName) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create Room") },
        text = {
            Column {
                Text("Give your room a name")
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = roomName,
                    onValueChange = { if (it.length <= 50) roomName = it },
                    label = { Text("Room Name") },
                    modifier = Modifier.fillMaxWidth().testTag("createRoom_nameField"),
                    singleLine = true
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(roomName) },
                enabled = roomName.isNotBlank(),
                modifier = Modifier.testTag("createRoom_createButton")
            ) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}
