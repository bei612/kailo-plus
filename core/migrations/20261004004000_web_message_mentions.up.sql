-- DD-39/81、17 §2：只固定语义目标引用，正文仍仅归 Relay。
ALTER TABLE admission.publish_attempt
  ADD COLUMN mention_installation_ids uuid[] NOT NULL DEFAULT '{}';
