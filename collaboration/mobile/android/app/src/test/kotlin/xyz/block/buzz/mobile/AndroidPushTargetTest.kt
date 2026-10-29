package xyz.block.buzz.mobile

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AndroidPushTargetTest {
    @Test fun coreTargetUsesTheExistingFlutterNavigationContract() {
        val target = AndroidPushTarget.fromData(mapOf("tenant_id" to "tenant", "channel_id" to "channel", "event_id" to "event"))!!
        assertEquals(mapOf("communityId" to "tenant", "channelId" to "channel", "eventId" to "event"), target.flutterArguments())
        assertNull(AndroidPushTarget.fromData(mapOf("channel_id" to "channel", "event_id" to "event")))
        assertNull(AndroidPushTarget.fromData(mapOf("tenant_id" to "tenant", "channel_id" to " ", "event_id" to "event")))
    }

    @Test fun lateAcknowledgementCannotEraseTheNextNotification() {
        val first = AndroidPushTarget("tenant", "channel", "first")
        val second = first.copy(eventId = "second")
        val pending = PendingPushTarget()
        pending.record(first)
        pending.record(second)
        pending.removeIfMatching(first)
        assertEquals(second, pending.take())
        assertNull(pending.take())
    }
}
