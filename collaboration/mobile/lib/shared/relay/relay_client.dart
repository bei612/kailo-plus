/// Thrown when an HTTP call to the relay returns a non-2xx status code.
///
/// Retained for backwards compatibility with provider code that still
/// references it during the migration to pure-nostr WebSocket flows.
class RelayException implements Exception {
  final int statusCode;
  final String body;

  RelayException(this.statusCode, this.body);

  @override
  String toString() {
    final trimmedBody = body.trim();
    if (trimmedBody.isEmpty) {
      return 'RelayException($statusCode)';
    }
    return 'RelayException($statusCode): $trimmedBody';
  }
}
