# Security Policy

## Reporting a Vulnerability

Do not disclose vulnerabilities, credentials, private Relay events, or working exploits in a public
GitHub issue.

Use GitHub's private vulnerability reporting flow from the repository's **Security** tab. Include:

- affected commit or version;
- impact and required privileges;
- minimal reproduction steps;
- whether an `nsec`, Relay membership, Agent Control access, or malicious repository is required;
- a suggested mitigation, if available.

If private vulnerability reporting is unavailable, open a public issue containing no sensitive
technical detail and ask the maintainer to establish a private contact channel.

## Supported Versions

Until the first stable release, only the latest `main` branch is supported. Security fixes are not
backported unless a release note explicitly says otherwise.

## Security Boundaries

- Buzz Web is a client, not an authorization boundary. The Relay must enforce authentication,
  membership, event visibility, media access, and Git permissions.
- Public `config.json`, JavaScript, source maps, and static assets must contain no secrets.
- NIP-07 is recommended on shared devices. Locally imported keys remain in page memory while
  unlocked even when their IndexedDB copy is encrypted.
- Agent Control must listen on a private interface, accept only exact allowlisted public-key to
  systemd-unit mappings, validate NIP-98 requests, and sit behind TLS.
- Repository content is untrusted. HTML previews must remain opt-in and sandboxed without
  `allow-same-origin`; SVG and active content must not execute in the parent origin.

Deployers should also set a restrictive Content Security Policy at the edge, keep the Relay and
Agent Control patched, rate-limit public endpoints, and monitor rejected authentication requests.
