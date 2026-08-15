package com.shyden.shytalk.navigation

import com.shyden.shytalk.data.repository.BanStatus
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * SHY-0143 — mapping the server's [BanStatus] onto the cold-start [BanState].
 *
 * The rule is not new: `AuthViewModel.checkAndApplyBan()` already classifies a
 * ban as `banType == "device"`, else network. Duplicating that inline in a
 * second call site is how two paths drift into disagreeing about what a ban
 * means, so it lives in one tested function that both can use.
 *
 * The interesting cases are the ones the server can legitimately produce and a
 * naive mapping gets wrong: `isBanned = false` with a stale `banType` still
 * populated, and an unrecognised `banType`.
 */
class BanStateMappingTest {
    @Test
    fun `a device ban maps to deviceBanned and carries reason and expiry`() {
        val s =
            BanStatus(isBanned = true, banType = "device", reason = "Ban evasion", expiresAt = "2026-09-01T00:00:00Z")
                .toBanState()
        assertEquals(BanState(deviceBanned = true, reason = "Ban evasion", expiresAt = "2026-09-01T00:00:00Z"), s)
    }

    @Test
    fun `a network ban maps to networkBanned`() {
        val s = BanStatus(isBanned = true, banType = "network", reason = "ASN block").toBanState()
        assertEquals(BanState(networkBanned = true, reason = "ASN block"), s)
    }

    @Test
    fun `isBanned false is NOT a ban even when banType is still populated`() {
        // A lifted ban can come back with the old type still set. Reading
        // banType without checking isBanned would lock out a user whose ban was
        // just removed.
        assertEquals(BanState(), BanStatus(isBanned = false, banType = "device", reason = "old").toBanState())
    }

    @Test
    fun `an unrecognised ban type is treated as a NETWORK ban and never as no ban`() {
        // Fail closed. A future server-side type this client does not know must
        // still block: mapping it to "no ban" would turn an unknown ban into a
        // silent bypass, which is precisely the class of hole this story exists
        // to close.
        assertEquals(BanState(networkBanned = true), BanStatus(isBanned = true, banType = "asn-v2").toBanState())
    }

    @Test
    fun `a banned status with a null type still blocks`() {
        assertEquals(BanState(networkBanned = true), BanStatus(isBanned = true, banType = null).toBanState())
    }
}
