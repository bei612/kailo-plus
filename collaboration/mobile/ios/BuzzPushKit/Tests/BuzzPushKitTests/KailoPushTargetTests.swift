import Foundation
import Testing

@testable import BuzzPushKit

private let eventID = String(repeating: "ab", count: 32)

@Test func `Decode the ids a Kailo push carries`() {
  let target = KailoPushTarget.decodeIfPresent(from: [
    KailoPushTarget.userInfoKey: [
      "tenant_id": "7F0D1C3E-2B4A-4C5D-8E9F-0A1B2C3D4E5F",
      "channel_id": "6f0d1c3e-2b4a-4c5d-8e9f-0a1b2c3d4e5f",
      "event_id": eventID.uppercased(),
    ]
  ])
  #expect(
    target
      == KailoPushTarget(
        tenantID: "7f0d1c3e-2b4a-4c5d-8e9f-0a1b2c3d4e5f",
        channelID: "6f0d1c3e-2b4a-4c5d-8e9f-0a1b2c3d4e5f",
        eventID: eventID
      ))
  #expect(target?.queryFilters.count == 1)
  #expect(target?.queryFilters.first?["ids"] as? [String] == [eventID])
}

@Test func `Reject a Kailo push without well-formed ids`() {
  let good: [String: Any] = [
    "tenant_id": "a-1", "channel_id": "c-1", "event_id": eventID,
  ]
  #expect(KailoPushTarget.decodeIfPresent(from: [KailoPushTarget.userInfoKey: good]) != nil)
  for broken in [
    good.merging(["event_id": "short"]) { $1 },
    good.merging(["channel_id": ""]) { $1 },
    good.merging(["tenant_id": "../escape"]) { $1 },
    good.filter { $0.key != "channel_id" },
  ] {
    #expect(KailoPushTarget.decodeIfPresent(from: [KailoPushTarget.userInfoKey: broken]) == nil)
  }
  #expect(KailoPushTarget.decodeIfPresent(from: ["aps": ["badge": 1]]) == nil)
}

@Test func `Without a synced community for the Tenant the fixed text stays`() async {
  let resolver = BuzzPushNotificationResolver(
    session: .shared,
    loadCommunitiesData: { nil },
    loadPrivateKey: { _ in nil }
  )
  let target = KailoPushTarget(tenantID: "t-1", channelID: "c-1", eventID: eventID)
  let resolution: BuzzPushResolution? = await withCheckedContinuation { continuation in
    resolver.resolve(kailo: target) { continuation.resume(returning: $0) }
  }
  #expect(resolution == nil)
}
