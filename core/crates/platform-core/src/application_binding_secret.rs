//! 03 §9 / DD-70 / V-SCN-47: binding secrets are written by Core inside the
//! same governed application_binding.create action, never by an operator side
//! channel. The Tenant admin submits values once, transiently, with the
//! original ActionCommand. After scope, permission, target, confirmation and
//! quota admission, Core freezes the exact SecretRefs in the EVALUATING
//! ActionExecution and only then writes version 1 of each locator with the
//! existing CAS=0 `write_once`. The binding stores only those references; the
//! values never enter Params, the database, logs, Workflow history, audit or
//! the response. Activation still requires the adapter's audited version-pinned
//! read of every reference before ACTIVE (application_binding_native.rs).

use super::*;
use crate::governance::Governance;

/// Values above this size are not service credentials; refuse rather than
/// forward an unbounded body to OpenBao.
const MAX_SECRET_BYTES: usize = 64 * 1024;
const INTENT: &str = "bindingSecretRefs";

fn unavailable() -> Refusal {
    Refusal::Unavailable("binding secret store unavailable".into())
}

/// Transient values of one submitted command. Deliberately no Debug, Clone or
/// Serialize: every use is an explicit `write_once` below.
pub(crate) struct Staged(Vec<(String, String)>);

impl Staged {
    /// Only application_binding.create may carry values. Duplicate keys and
    /// empty or oversized values are refused before any admission work.
    pub(crate) fn from_command(cmd: &contracts::ActionCommand) -> Result<Option<Self>, Refusal> {
        let Some(values) = cmd.binding_secret_values.as_ref() else {
            return Ok(None);
        };
        if cmd.action_key != CREATE {
            return Err(invalid());
        }
        let mut keys = BTreeSet::new();
        let mut staged = Vec::with_capacity(values.len());
        for entry in values {
            if !keys.insert(entry.secret_key.as_str())
                || entry.value.is_empty()
                || entry.value.len() > MAX_SECRET_BYTES
            {
                return Err(invalid());
            }
            staged.push((entry.secret_key.clone(), entry.value.clone()));
        }
        Ok(Some(Self(staged)))
    }
}

/// Reader identity of the binding's secrets. A REMOTE_ADAPTER reads them as
/// the binding SERVICE identity (validate() requires a directory reader with
/// exactly this audience); a PROTOCOL_PEER's credentials are read by Core and
/// projected to the Gateway (application_binding_credentials.rs).
fn audience(manifest: &Value) -> Result<String, Refusal> {
    if native::Connector::from_manifest(manifest)? == native::Connector::RemoteAdapter {
        let connector = &manifest["executionConnector"];
        let audience = text(connector, "actionTokenAudience").map_err(|_| blocked())?;
        return Ok(audience.to_owned());
    }
    let reader = std::env::var("OPENBAO_SERVICE_IDENTITY").map_err(|_| blocked())?;
    if reader.trim().is_empty() {
        return Err(blocked());
    }
    Ok(reader)
}

fn path(binding: Uuid, key: &str) -> String {
    format!("application-binding/{binding}/{key}")
}

/// The exact references this create owns. Locators are derived from the
/// binding ID chosen in the admitted command, so the adapter's OpenBao Agent
/// template can be delivered before the binding exists; version 1 is the
/// only version a CAS=0 first write can produce.
fn references(locator: impl Fn(&str) -> String, manifest: &Value) -> Result<Vec<Value>, Refusal> {
    let declarations = manifest["secretSchema"].as_array().ok_or_else(blocked)?;
    // No declared secret has no reader (a DD-127 native page entry has none).
    if declarations.is_empty() {
        return Ok(Vec::new());
    }
    let audience = audience(manifest)?;
    let mut refs = Vec::new();
    for declared in declarations {
        let key = text(declared, "secretKey").map_err(|_| blocked())?;
        refs.push(json!({"secretKey":key,"locator":locator(key),"version":1,"audience":audience}));
    }
    Ok(refs)
}

/// Core validates against the release's generic declaration only (07 §2.6):
/// a STRING value and a closed string schema in lengthOrFormat — the same
/// vocabulary the PROTOCOL_PEER credential projection accepts. Anything else
/// cannot be checked by Core and is refused instead of silently accepted.
fn validate_value(declared: &Value, value: &str) -> Result<(), Refusal> {
    if declared["valueType"] != "STRING" {
        return Err(blocked());
    }
    let format = text(declared, "lengthOrFormat").map_err(|_| blocked())?;
    let schema: Value = serde_json::from_str(format).map_err(|_| blocked())?;
    let fields = schema.as_object().ok_or_else(blocked)?;
    if fields.get("type").and_then(Value::as_str) != Some("string")
        || fields
            .keys()
            .any(|key| !matches!(key.as_str(), "type" | "minLength" | "maxLength" | "pattern"))
    {
        return Err(blocked());
    }
    let validator = crate::capability_contract::schema_validator(&schema, &BTreeMap::new())?;
    if !validator.is_valid(&json!(value)) {
        return Err(invalid());
    }
    Ok(())
}

/// Pair each declaration with exactly one submitted value. Missing, extra or
/// unknown keys are refused; nothing is written for a partial set.
fn pair<'a>(manifest: &'a Value, staged: &'a Staged) -> Result<Vec<(&'a str, &'a str)>, Refusal> {
    let declared = manifest["secretSchema"].as_array().ok_or_else(blocked)?;
    if declared.len() != staged.0.len() {
        return Err(invalid());
    }
    let mut pairs = Vec::with_capacity(declared.len());
    for declaration in declared {
        let key = text(declaration, "secretKey").map_err(|_| blocked())?;
        let (_, value) = staged
            .0
            .iter()
            .find(|(candidate, _)| candidate == key)
            .ok_or_else(invalid)?;
        validate_value(declaration, value)?;
        pairs.push((key, value.as_str()));
    }
    Ok(pairs)
}

/// Called by the original decide() after all admission checks and before the
/// gate is allowed. `staged` is None only when the same idempotent command is
/// re-entered without values: the original request must then already have
/// written every frozen locator, otherwise the action cannot proceed.
pub(crate) async fn stage(
    g: &Governance,
    ae: &Execution,
    params: &Params,
    staged: Option<&Staged>,
) -> Result<(), Refusal> {
    if ae.action_key != CREATE || ae.gate_state != "EVALUATING" {
        return Err(conflict());
    }
    let request = requested(&params.to_json()["applicationBindingCreate"])?;
    if request.id != ae.target_id || !request.secret_refs.is_empty() {
        return Err(invalid());
    }
    let manifest: Option<Value> = sqlx::query_scalar(
        "select manifest from catalog.component_release
         where id=$1 and status='APPROVED' and approved_by_action_execution_id is not null",
    )
    .bind(request.release)
    .fetch_optional(&g.pool)
    .await?;
    let manifest = manifest.ok_or_else(blocked)?;
    let refs = references(
        |key| {
            g.secrets
                .tenant_locator(ae.tenant_id, &path(request.id, key))
        },
        &manifest,
    )?;
    let pairs = staged.map(|staged| pair(&manifest, staged)).transpose()?;
    // Freeze the exact references before the first external write (AGENTS
    // rule 10). Re-entry may only find the same references.
    let frozen = sqlx::query(
        "update admission.action_execution
         set parameters=parameters||jsonb_build_object('bindingSecretRefs',$2::jsonb)
         where id=$1 and action_key=$3 and gate_state='EVALUATING'
           and (parameters->'bindingSecretRefs' is null
             or parameters->'bindingSecretRefs'=$2::jsonb)",
    )
    .bind(ae.id)
    .bind(json!(refs))
    .bind(CREATE)
    .execute(&g.pool)
    .await?
    .rows_affected();
    if frozen != 1 {
        return Err(conflict());
    }
    // pair() and references() both follow the release's declaration order.
    let values: Vec<Option<&str>> = match &pairs {
        Some(pairs) => pairs.iter().map(|(_, value)| Some(*value)).collect(),
        None => vec![None; refs.len()],
    };
    for (reference, value) in refs.iter().zip(values) {
        let locator = text(reference, "locator")?;
        // CAS=0 single write. A lost response re-reads and compares the same
        // value; a different existing value is a conflict, never a second
        // version. Without values only the original write can be observed.
        let observed = match value {
            Some(value) => g.secrets.write_once(locator, "value", value).await,
            None => g.secrets.observed_version(locator).await,
        };
        let version = match observed {
            Ok(version) => version,
            Err(secret_store::SecretError::WriteRejected) => return Err(conflict()),
            Err(_) => return Err(unavailable()),
        };
        match version {
            1 => {}
            // The original request never wrote this locator; its values are
            // gone and cannot be reconstructed.
            0 if value.is_none() => return Err(invalid()),
            _ => return Err(conflict()),
        }
    }
    Ok(())
}

/// The references prewrite records on the binding: exactly the frozen intent,
/// rechecked against the release and this binding's derivation.
pub(super) fn frozen(
    ae: &Execution,
    manifest: &Value,
    binding: Uuid,
) -> Result<Vec<Value>, Refusal> {
    let refs = ae
        .parameters
        .as_ref()
        .and_then(|parameters| parameters.get(INTENT))
        .and_then(Value::as_array)
        .ok_or_else(conflict)?;
    let declared = manifest["secretSchema"].as_array().ok_or_else(blocked)?;
    if refs.len() != declared.len() {
        return Err(conflict());
    }
    if declared.is_empty() {
        return Ok(Vec::new());
    }
    let audience = audience(manifest)?;
    let prefix = format!("tenants/{}/", ae.tenant_id);
    for (reference, declaration) in refs.iter().zip(declared) {
        exact(
            reference,
            &["secretKey", "locator", "version", "audience"],
            &[],
        )
        .map_err(|_| conflict())?;
        let key = text(declaration, "secretKey").map_err(|_| blocked())?;
        let locator = text(reference, "locator").map_err(|_| conflict())?;
        if reference["secretKey"] != key
            || reference["version"] != 1
            || reference["audience"] != audience.as_str()
            || !locator.starts_with(&prefix)
            || !locator.ends_with(&format!("/{}", path(binding, key)))
        {
            return Err(conflict());
        }
    }
    Ok(refs.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(connector: &str, secrets: Value) -> Value {
        json!({"executionConnector":{"mode":connector,"adapterProtocolRange":"1",
            "actionTokenAudience":"kailo-adapter-fixture"},"secretSchema":secrets})
    }

    fn declaration(key: &str, format: Value) -> Value {
        json!({"secretKey":key,"valueType":"STRING","lengthOrFormat":format.to_string(),
            "rotationClass":"SERVICE_CREDENTIAL","deliveryMode":"FILE","restartRequired":false})
    }

    fn staged(values: &[(&str, &str)]) -> Staged {
        Staged(
            values
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect(),
        )
    }

    fn command(values: Value, action: &str) -> contracts::ActionCommand {
        serde_json::from_value(json!({"actionKey":action,"idempotencyKey":Uuid::new_v4(),
            "bindingSecretValues":values}))
        .unwrap()
    }

    #[test]
    fn only_binding_create_carries_distinct_bounded_values() {
        let ok = command(json!([{"secretKey":"a","value":"x"}]), CREATE);
        assert_eq!(Staged::from_command(&ok).unwrap().unwrap().0.len(), 1);
        let none: contracts::ActionCommand =
            serde_json::from_value(json!({"actionKey":CREATE,"idempotencyKey":Uuid::new_v4()}))
                .unwrap();
        assert!(Staged::from_command(&none).unwrap().is_none());
        for invalid in [
            command(json!([{"secretKey":"a","value":"x"}]), DISABLE),
            command(json!([{"secretKey":"a","value":"x"}]), "resource.create"),
            command(
                json!([{"secretKey":"a","value":"x"},{"secretKey":"a","value":"y"}]),
                CREATE,
            ),
            command(json!([{"secretKey":"a","value":""}]), CREATE),
            command(
                json!([{"secretKey":"a","value":"x".repeat(MAX_SECRET_BYTES + 1)}]),
                CREATE,
            ),
        ] {
            assert!(Staged::from_command(&invalid).is_err());
        }
    }

    #[test]
    fn values_pair_exactly_with_the_release_declaration() {
        let release = manifest(
            "REMOTE_ADAPTER",
            json!([
                declaration("native_api_key", json!({"type":"string","minLength":8})),
                declaration(
                    "oidc_client_secret",
                    json!({"type":"string","pattern":"^[A-Za-z0-9]+$"})
                )
            ]),
        );
        let values = staged(&[
            ("oidc_client_secret", "abc123"),
            ("native_api_key", "0123456789"),
        ]);
        assert_eq!(
            pair(&release, &values).unwrap(),
            vec![
                ("native_api_key", "0123456789"),
                ("oidc_client_secret", "abc123")
            ]
        );
        for invalid in [
            staged(&[("native_api_key", "0123456789")]),
            staged(&[("native_api_key", "0123456789"), ("other", "abc123")]),
            staged(&[
                ("native_api_key", "0123456789"),
                ("oidc_client_secret", "abc123"),
                ("extra", "x"),
            ]),
            staged(&[
                ("native_api_key", "short"),
                ("oidc_client_secret", "abc123"),
            ]),
            staged(&[
                ("native_api_key", "0123456789"),
                ("oidc_client_secret", "not valid"),
            ]),
        ] {
            assert!(pair(&release, &invalid).is_err());
        }
        // Core cannot validate an undeclared vocabulary; refuse, never accept.
        for format in [
            json!({"type":"object"}),
            json!({"type":"string","format":"uri"}),
            json!("free text"),
        ] {
            let mut odd = release.clone();
            odd["secretSchema"][0] = declaration("native_api_key", format);
            assert!(matches!(pair(&odd, &values), Err(Refusal::Blocked(_))));
        }
        let mut binary = release.clone();
        binary["secretSchema"][0]["valueType"] = json!("BYTES");
        assert!(matches!(pair(&binary, &values), Err(Refusal::Blocked(_))));
    }

    #[test]
    fn references_are_derived_from_binding_and_reader_identity() {
        let binding = Uuid::new_v4();
        let tenant = Uuid::new_v4();
        let release = manifest(
            "REMOTE_ADAPTER",
            json!([declaration("native_api_key", json!({"type":"string"}))]),
        );
        let locator = |key: &str| format!("tenants/{tenant}/kv/{}", path(binding, key));
        let refs = references(locator, &release).unwrap();
        let expected = format!("tenants/{tenant}/kv/application-binding/{binding}/native_api_key");
        assert_eq!(
            refs,
            vec![json!({"secretKey":"native_api_key","locator":expected,
                "version":1,"audience":"kailo-adapter-fixture"})]
        );
        assert!(references(locator, &manifest("REMOTE_ADAPTER", json!([])))
            .unwrap()
            .is_empty());
        assert!(references(locator, &manifest("REMOTE_ADAPTER", json!(null))).is_err());
    }
}
