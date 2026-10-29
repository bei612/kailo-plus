-- DD-151(3)(5): derived dispatch checkpoints, never a second message/read authority.
ALTER TABLE projection.push_cursor ADD COLUMN lease_id uuid, ADD COLUMN lease_until timestamptz;
CREATE TABLE projection.push_send_intent (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
 tenant_principal_id uuid NOT NULL REFERENCES identity.principal(id),
 device_pubkey text NOT NULL,
 registration_version integer NOT NULL CHECK (registration_version > 0),
 platform text NOT NULL CHECK (platform IN ('APNS','FCM')),
 provider_target text NOT NULL CHECK (length(provider_target) BETWEEN 1 AND 512),
 event_id text NOT NULL CHECK (event_id ~ '^[0-9a-f]{64}$'),
 channel_id text NOT NULL,
 root_id text CHECK (root_id ~ '^[0-9a-f]{64}$'),
 event_created_at bigint NOT NULL CHECK (event_created_at >= 0),
 state text NOT NULL DEFAULT 'PREPARED' CONSTRAINT push_send_checkpoint_states
   CHECK (state IN ('PREPARED','CLAIMED','SENDING','RETRY','ACCEPTED','REJECTED','CANCELLED','UNKNOWN')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 lease_id uuid, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 provider_reference text CHECK (length(provider_reference) BETWEEN 1 AND 512),
 result_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,device_pubkey,event_id),
 FOREIGN KEY (tenant_id,device_pubkey) REFERENCES identity.push_registration(tenant_id,device_pubkey)
);
CREATE INDEX push_send_ready ON projection.push_send_intent(next_attempt_at) WHERE state IN ('PREPARED','RETRY','CLAIMED','SENDING');
COMMENT ON TABLE projection.push_send_intent IS 'Content-free DD151 derived checkpoint: ACCEPTED is provider acceptance, UNKNOWN is never automatically resent or counted as accepted.';
-- Durable ownership before OpenBao CAS=0, plus recoverable retirement after replacement.
CREATE TABLE admission.push_token_intent (
 locator text PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES identity.tenant(id),
 audience text NOT NULL, device_pubkey text NOT NULL,
 state text NOT NULL DEFAULT 'PREPARING' CONSTRAINT push_token_checkpoint_states
   CHECK (state IN ('PREPARING','BOUND','RETIRING','RETIRED')),
 lease_until timestamptz NOT NULL,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- Already-bound tokens use the same retirement consumer. No token values are copied.
INSERT INTO admission.push_token_intent(locator,tenant_id,audience,device_pubkey,state,lease_until)
SELECT token_secret_locator,tenant_id,token_secret_audience,device_pubkey,'BOUND',now()
FROM identity.push_registration WHERE token_secret_locator IS NOT NULL;
