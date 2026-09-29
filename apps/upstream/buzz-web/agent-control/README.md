# Buzz Agent Control

Agent Control is an optional companion for Buzz Web. It lets an authorized browser request that a
known remote Agent's systemd unit be started or restarted. It exists because an offline Agent cannot
receive a command through the Relay.

The service is deliberately narrow:

- the browser signs `POST /start` with NIP-98;
- only configured owner public keys are accepted;
- each configured Agent public key maps to one exact `.service` unit;
- authorization events expire after 60 seconds and cannot be replayed in the current process;
- request bodies are limited to 4 KiB;
- the service never receives an `nsec`, model credential, or Agent environment file.

## Requirements

- Node.js 22 or newer;
- Linux with `/usr/bin/systemctl`;
- a dedicated private listener or host firewall rule;
- a TLS reverse proxy that preserves the exact public request URL;
- permission for the service account to start only the configured units.

## Configuration

All public keys are 64-character lowercase hexadecimal values. Do not put private keys here.

```dotenv
LISTEN_HOST=127.0.0.1
LISTEN_PORT=8095
PUBLIC_BASE_URL=https://buzz.example.com/app/api/agent-control
OWNER_PUBKEYS=<owner-public-key-hex>
AGENT_UNITS_JSON={"<agent-public-key-hex>":"buzz-codex-agent.service"}
TRUSTED_PROXY_IPS=127.0.0.1
```

`PUBLIC_BASE_URL` must match the URL used by the browser byte-for-byte before `/start`; it is part of
the NIP-98 signature. `TRUSTED_PROXY_IPS` is a comma-separated allowlist of direct TCP peers, not
values from `X-Forwarded-For`. Leave it empty only when a host firewall already restricts the
listener.

Set the Web runtime configuration to the same public base URL:

```json
{
  "agentControlUrl": "https://buzz.example.com/app/api/agent-control"
}
```

The reverse proxy should expose only:

| Public path | Upstream path | Purpose |
| --- | --- | --- |
| `.../agent-control/start` | `/start` | signed start/restart request |
| `.../agent-control/healthz` | `/healthz` | private health check |

Do not expose this service on a separate permissive origin. Keep TLS, origin policy, rate limiting,
and request logging at the edge; redact `Authorization` headers.

## Run and Test

```bash
npm ci
npm test
npm start
```

The process validates all configuration before listening. A start request returns `202` only after
systemd reports the selected unit active. Requesting an already active unit deliberately restarts it
so a stale process that stopped publishing Presence can recover.

In production, run the process under systemd with `NoNewPrivileges=true`, a read-only filesystem,
and the smallest possible systemd authorization. Do not grant arbitrary `systemctl` or shell access.

## Operational Notes

- In-memory replay tracking resets when Agent Control restarts. The short timestamp window still
  limits reuse; deployments needing stronger guarantees should add a shared TTL replay store before
  running multiple replicas.
- `TRUSTED_PROXY_IPS` applies to `/healthz` too. Ensure the health checker reaches the service from an
  allowed direct address.
- Agent online/offline status still comes from Relay Presence. A successful `202` means the unit is
  active, not that the Agent has already connected to the Relay.
