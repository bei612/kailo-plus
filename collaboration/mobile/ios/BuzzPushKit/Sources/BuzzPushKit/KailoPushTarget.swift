import Foundation

/// DD-151(4): Kailo's push carries only ids under `kailo_push` — the Tenant, the Relay
/// channel and the event. The notification extension uses them to read that one message
/// through this device's own Relay identity (DD-75) and replace the fixed system text.
public struct KailoPushTarget: Equatable, Sendable {
  public static let userInfoKey = "kailo_push"

  public let tenantID: String
  public let channelID: String
  public let eventID: String

  public init(tenantID: String, channelID: String, eventID: String) {
    self.tenantID = tenantID
    self.channelID = channelID
    self.eventID = eventID
  }

  /// `nil` unless every id is present and well formed: a 64-hex event id, a bounded channel
  /// id and a bounded Tenant id. Ids are compared lower-cased.
  public static func decodeIfPresent(from userInfo: [AnyHashable: Any]) -> KailoPushTarget? {
    guard let raw = userInfo[userInfoKey] as? [String: Any],
      let tenant = (raw["tenant_id"] as? String)?.lowercased(),
      let channel = (raw["channel_id"] as? String)?.lowercased(),
      let event = (raw["event_id"] as? String)?.lowercased(),
      Self.isBoundedID(tenant), Self.isBoundedID(channel),
      event.count == 64, event.allSatisfy({ $0.isHexDigit })
    else { return nil }
    return KailoPushTarget(tenantID: tenant, channelID: channel, eventID: event)
  }

  /// The Relay query for exactly this event.
  public var queryFilters: [[String: Any]] {
    [["ids": [eventID], "limit": 1]]
  }

  /// The event is the one the push named: same id, valid signature, same channel.
  public func matches(_ event: VerifiedNostrEvent, channelTag: String?) -> Bool {
    event.id.lowercased() == eventID
      && channelTag?.lowercased() == channelID
      && event.hasValidIDAndSignature()
  }

  private static func isBoundedID(_ value: String) -> Bool {
    !value.isEmpty && value.count <= 64
      && value.allSatisfy { $0.isHexDigit || $0 == "-" }
  }
}
