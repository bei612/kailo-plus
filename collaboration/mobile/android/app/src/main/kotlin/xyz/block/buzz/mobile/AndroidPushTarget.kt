package xyz.block.buzz.mobile

/** Content-free Core target. No routing fact grants access: Relay/BFF reauthorize reads. */
internal data class AndroidPushTarget(val tenantId: String, val channelId: String, val eventId: String) {
    fun flutterArguments(): Map<String, String> = mapOf(
        "communityId" to tenantId, "channelId" to channelId, "eventId" to eventId,
    )

    companion object {
        fun fromData(data: Map<String, String?>): AndroidPushTarget? {
            fun id(key: String): String? = data[key]?.takeIf { it.isNotBlank() && it.length <= 128 }
            return AndroidPushTarget(id("tenant_id") ?: return null,
                id("channel_id") ?: return null, id("event_id") ?: return null)
        }
    }
}

/** Same compare-and-remove handoff as the original iOS navigation buffer. */
internal class PendingPushTarget {
    var current: AndroidPushTarget? = null
        private set
    fun record(target: AndroidPushTarget) { current = target }
    fun removeIfMatching(target: AndroidPushTarget) { if (current == target) current = null }
    fun take(): AndroidPushTarget? = current.also { current = null }
}
