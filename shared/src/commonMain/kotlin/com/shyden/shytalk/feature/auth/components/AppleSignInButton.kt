package com.shyden.shytalk.feature.auth.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.painterResource
import org.jetbrains.compose.resources.stringResource

@Composable
fun AppleSignInButton(
    onClick: () -> Unit,
    isLoading: Boolean,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled && !isLoading,
        modifier =
            modifier
                .fillMaxWidth()
                .height(48.dp)
                .testTag("signIn_appleButton"),
        shape = RoundedCornerShape(24.dp),
        colors =
            ButtonDefaults.outlinedButtonColors(
                containerColor = Color.Black,
                contentColor = Color.White,
            ),
        border = BorderStroke(1.dp, Color(0xFF333333)),
    ) {
        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = Color.White,
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(stringResource(Res.string.signing_in_loading))
        } else {
            Icon(
                painter = painterResource(Res.drawable.ic_apple_logo),
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = Color.Unspecified,
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(stringResource(Res.string.sign_in_with_apple))
        }
    }
}
