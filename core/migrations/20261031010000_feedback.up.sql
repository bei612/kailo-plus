-- DD-158(1)(2): Core-owned private feedback to the deployment operator.
-- 2. FeedbackSubmission（03 §2）。正文与诊断只在这里，审计只记 ID 与标记。
CREATE SCHEMA support;
CREATE TABLE support.feedback_submission (
    id                uuid        PRIMARY KEY,
    tenant_id         uuid        NOT NULL REFERENCES identity.tenant (id),
    principal_id      uuid        NOT NULL,
    idempotency_key   uuid        NOT NULL,
    parameter_hash    text        NOT NULL CHECK (parameter_hash ~ '^[0-9a-f]{64}$'),
    client            text        NOT NULL CONSTRAINT feedback_client_enum
                                  CHECK (client IN ('WEB','DESKTOP','MOBILE')),
    category          text        CONSTRAINT feedback_category_enum
                                  CHECK (category IN ('BUG','PRAISE','NEEDS_WORK')),
    message           text        NOT NULL CHECK (btrim(message) = message AND message <> ''
                                  AND char_length(message) <= 4000),
    diagnostics       text        CHECK (diagnostics IS NULL OR
                                  (diagnostics <> '' AND octet_length(diagnostics) <= 4096)),
    attachment        bytea       CHECK (attachment IS NULL OR octet_length(attachment) BETWEEN 1 AND 2097152),
    attachment_mime   text        CHECK (attachment_mime IN ('image/png','image/jpeg','image/webp')),
    attachment_sha256 text        CHECK (attachment_sha256 ~ '^[0-9a-f]{64}$'),
    state             text        NOT NULL DEFAULT 'NEW' CONSTRAINT feedback_state_enum
                                  CHECK (state IN ('NEW','TRIAGED','CLOSED')),
    version           integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feedback_submission_attachment_check CHECK (
        (attachment IS NULL) = (attachment_mime IS NULL)
        AND (attachment IS NULL) = (attachment_sha256 IS NULL)),
    CONSTRAINT feedback_submission_idempotency UNIQUE (tenant_id, principal_id, idempotency_key)
);
-- 限速按本人与时间窗计数；运营方按状态与时间倒序分页。
CREATE INDEX feedback_submission_by_principal ON support.feedback_submission (tenant_id, principal_id, created_at);
CREATE INDEX feedback_submission_by_state ON support.feedback_submission (state, created_at DESC, id);

-- 分拣只前移，不回退；正文、诊断与附件提交后不可改写。
CREATE FUNCTION support.guard_feedback_submission() RETURNS trigger AS $$
BEGIN
    IF (NEW.id, NEW.tenant_id, NEW.principal_id, NEW.idempotency_key, NEW.parameter_hash, NEW.client,
        NEW.category, NEW.message, NEW.diagnostics, NEW.attachment, NEW.attachment_mime,
        NEW.attachment_sha256, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.tenant_id, OLD.principal_id, OLD.idempotency_key, OLD.parameter_hash, OLD.client,
        OLD.category, OLD.message, OLD.diagnostics, OLD.attachment, OLD.attachment_mime,
        OLD.attachment_sha256, OLD.created_at) THEN
        RAISE EXCEPTION '反馈提交后不可改写' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ((OLD.state = 'NEW' AND NEW.state IN ('NEW','TRIAGED'))
            OR (OLD.state = 'TRIAGED' AND NEW.state IN ('TRIAGED','CLOSED'))
            OR (OLD.state = 'CLOSED' AND NEW.state = 'CLOSED')) THEN
        RAISE EXCEPTION '反馈分拣只能前移' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER feedback_submission_guard BEFORE UPDATE ON support.feedback_submission
    FOR EACH ROW EXECUTE FUNCTION support.guard_feedback_submission();

