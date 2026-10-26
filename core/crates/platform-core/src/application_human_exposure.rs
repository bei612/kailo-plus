//! HUMAN result exposure is a projection of the approved release, not a grant.
//! The admitted binding transaction freezes it before contacting the adapter.
//! Old generations keep their immutable mapping for already frozen execution;
//! every caller still checks the binding lifecycle, target and fresh authority.
use super::*;

struct Declared<'a> {
    key: &'a str,
    version: i32,
    mode: &'a str,
    schema: &'a str,
    redaction: &'a str,
}

fn declarations(manifest: &Value) -> Result<Vec<Declared<'_>>, Refusal> {
    let mut keys = BTreeSet::new();
    manifest["actionDefinitions"]
        .as_array()
        .ok_or_else(blocked)?
        .iter()
        .map(|action| {
            let key = text(action, "actionKey")?;
            let version = action["version"]
                .as_i64()
                .and_then(|v| i32::try_from(v).ok())
                .filter(|v| *v > 0)
                .ok_or_else(blocked)?;
            let exposure = &action["resultExposurePolicy"];
            let mode = text(exposure, "mode")?;
            let schema = text(exposure, "outputSchemaHash")?;
            let redaction = text(exposure, "redactionPolicy")?;
            if !keys.insert((key, version))
                || !matches!(mode, "CONSUME_ONLY" | "READ" | "EXPORT")
                || schema.len() != 64
                || !schema
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                || action["outputSchemaDigest"] != schema
                || redaction != "PLATFORM_METADATA_ONLY"
            {
                return Err(blocked());
            }
            Ok(Declared {
                key,
                version,
                mode,
                schema,
                redaction,
            })
        })
        .collect()
}

/// Called only by the original admitted binding writer, in its transaction.
/// No policy exists if binding creation rolls back. A retry reads the same
/// owned policy; it never adopts a delegation or another binding's policy.
pub(super) async fn materialize(
    conn: &mut PgConnection,
    tenant: Uuid,
    binding: Uuid,
    generation: i64,
    release: Uuid,
    manifest: &Value,
) -> Result<(), Refusal> {
    let entries = declarations(manifest)?;
    let owned: bool = sqlx::query_scalar(
        "select exists(select 1 from catalog.application_binding b
        join projection.application_runtime p on p.binding_id=b.id and p.generation=$3
        join catalog.component_release r on r.id=p.component_release_id and r.status='APPROVED'
        where b.id=$1 and b.tenant_id=$2 and b.state='PROVISIONING'
          and b.projection_action_execution_id=p.action_execution_id and p.state='PENDING'
          and b.component_release_id=$4 and r.id=$4 and r.manifest=$5
          and p.normalized_manifest_digest=r.manifest_digest)",
    )
    .bind(binding)
    .bind(tenant)
    .bind(generation)
    .bind(release)
    .bind(manifest)
    .fetch_one(&mut *conn)
    .await?;
    if !owned {
        return Err(conflict());
    }
    let expected = i64::try_from(entries.len()).map_err(|_| blocked())?;
    for entry in entries {
        sqlx::query("insert into catalog.result_exposure_policy
            (id,tenant_id,mode,output_schema_hash,redaction_policy,version,status,
             application_binding_id,application_projection_generation,component_release_id,action_key,action_version)
            values($1,$2,$3,$4,$5,1,'ACTIVE',$6,$7,$8,$9,$10)
            on conflict(application_binding_id,application_projection_generation,action_key,action_version) do nothing")
            .bind(Uuid::new_v4()).bind(tenant).bind(entry.mode).bind(entry.schema).bind(entry.redaction)
            .bind(binding).bind(generation).bind(release).bind(entry.key).bind(entry.version)
            .execute(&mut *conn).await?;
        let exact: bool = sqlx::query_scalar("select exists(select 1 from catalog.result_exposure_policy
            where tenant_id=$1 and application_binding_id=$2 and application_projection_generation=$3
              and component_release_id=$4 and action_key=$5 and action_version=$6
              and mode=$7 and output_schema_hash=$8 and redaction_policy=$9 and version=1 and status='ACTIVE')")
            .bind(tenant).bind(binding).bind(generation).bind(release).bind(entry.key).bind(entry.version)
            .bind(entry.mode).bind(entry.schema).bind(entry.redaction).fetch_one(&mut *conn).await?;
        if !exact {
            return Err(conflict());
        }
    }
    let count: i64 = sqlx::query_scalar(
        "select count(*) from catalog.result_exposure_policy
        where tenant_id=$1 and application_binding_id=$2 and application_projection_generation=$3",
    )
    .bind(tenant)
    .bind(binding)
    .bind(generation)
    .fetch_one(&mut *conn)
    .await?;
    if count != expected {
        return Err(conflict());
    }
    Ok(())
}

/// Match only the immutable ownership of the execution's exact generation.
/// Lifecycle/target/permission gates remain at the original caller; requiring
/// today's active generation here would incorrectly cancel older native work.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn validate(
    conn: &mut PgConnection,
    tenant: Uuid,
    binding: Uuid,
    generation: i64,
    release: Uuid,
    action: &str,
    action_version: i32,
    policy: Uuid,
    policy_version: i32,
    declaration: &Value,
) -> Result<(), Refusal> {
    let exposure = &declaration["resultExposurePolicy"];
    if exposure["outputSchemaHash"] != declaration["outputSchemaDigest"]
        || exposure["redactionPolicy"] != "PLATFORM_METADATA_ONLY"
        || declaration["actionKey"] != action
        || declaration["version"] != action_version
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let valid: bool = sqlx::query_scalar("select exists(select 1 from catalog.result_exposure_policy p
        join projection.application_runtime runtime on runtime.binding_id=p.application_binding_id
          and runtime.generation=p.application_projection_generation and runtime.component_release_id=p.component_release_id
        where p.id=$1 and p.version=$2 and p.status='ACTIVE' and p.tenant_id=$3
          and p.application_binding_id=$4 and p.application_projection_generation=$5 and p.component_release_id=$6
          and p.action_key=$7 and p.action_version=$8 and p.mode=$9
          and p.output_schema_hash=$10 and p.redaction_policy=$11 and runtime.state='ACTIVE')")
        .bind(policy).bind(policy_version).bind(tenant).bind(binding).bind(generation).bind(release)
        .bind(action).bind(action_version).bind(text(exposure, "mode")?)
        .bind(text(declaration, "outputSchemaDigest")?).bind(text(exposure, "redactionPolicy")?)
        .fetch_one(&mut *conn).await?;
    if !valid {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> Value {
        let hash = "a".repeat(64);
        json!({"actionDefinitions":[{"actionKey":"knowledge.read@v3","version":3,"outputSchemaDigest":hash,
            "resultExposurePolicy":{"mode":"READ","outputSchemaHash":hash,"redactionPolicy":"PLATFORM_METADATA_ONLY"}}]})
    }
    #[test]
    fn maximum_exposure_is_exact_and_never_invents_none() {
        let original = manifest();
        let parsed = declarations(&original).unwrap();
        assert_eq!(parsed[0].mode, "READ");
        for change in [json!("NONE"), json!("UNKNOWN")] {
            let mut changed = original.clone();
            changed["actionDefinitions"][0]["resultExposurePolicy"]["mode"] = change;
            assert!(declarations(&changed).is_err());
        }
        let mut changed = original.clone();
        changed["actionDefinitions"][0]["resultExposurePolicy"]["outputSchemaHash"] =
            json!("b".repeat(64));
        assert!(declarations(&changed).is_err());
        let mut changed = original.clone();
        changed["actionDefinitions"][0]["resultExposurePolicy"]["redactionPolicy"] =
            json!("PASSTHROUGH");
        assert!(declarations(&changed).is_err());
        let mut changed = original.clone();
        changed["actionDefinitions"]
            .as_array_mut()
            .unwrap()
            .push(original["actionDefinitions"][0].clone());
        assert!(declarations(&changed).is_err());
    }

    #[tokio::test]
    #[ignore = "requires the migrated isolated APPLICATION database and base fixture"]
    async fn binding_materializes_only_its_immutable_approved_boundary() {
        use sqlx::{Acquire, Connection};
        let mut conn = PgConnection::connect(
            &std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL")
                .expect("isolated database URL"),
        )
        .await
        .unwrap();
        let mut outer = conn.begin().await.unwrap();
        sqlx::query("set local kailo.fixture_pending_human_exposure='on'")
            .execute(&mut *outer)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../../../verify/application-execution-dispatch.sql"
        ))
        .execute(&mut *outer)
        .await
        .unwrap();
        let (binding, release): (Uuid, Uuid) =
            sqlx::query_as("select binding,release from application_dispatch_fixture")
                .fetch_one(&mut *outer)
                .await
                .unwrap();
        let tenant = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let manifest: Value =
            sqlx::query_scalar("select manifest from catalog.component_release where id=$1")
                .bind(release)
                .fetch_one(&mut *outer)
                .await
                .unwrap();
        let declaration = &manifest["actionDefinitions"][0];
        let key = declaration["actionKey"].as_str().unwrap();
        // The same transaction owns policy creation and rolls it back on failure.
        let mut rolled_back = outer.begin().await.unwrap();
        materialize(&mut rolled_back, tenant, binding, 1, release, &manifest)
            .await
            .unwrap();
        rolled_back.rollback().await.unwrap();
        let count: i64 = sqlx::query_scalar(
            "select count(*) from catalog.result_exposure_policy where application_binding_id=$1",
        )
        .bind(binding)
        .fetch_one(&mut *outer)
        .await
        .unwrap();
        assert_eq!(count, 0);
        materialize(&mut outer, tenant, binding, 1, release, &manifest)
            .await
            .unwrap();
        let policy: Uuid = sqlx::query_scalar(
            "select id from catalog.result_exposure_policy where application_binding_id=$1",
        )
        .bind(binding)
        .fetch_one(&mut *outer)
        .await
        .unwrap();
        materialize(&mut outer, tenant, binding, 1, release, &manifest)
            .await
            .unwrap();
        let policies: Vec<Uuid> = sqlx::query_scalar(
            "select id from catalog.result_exposure_policy where application_binding_id=$1",
        )
        .bind(binding)
        .fetch_all(&mut *outer)
        .await
        .unwrap();
        assert_eq!(policies, vec![policy]);
        assert!(
            materialize(&mut outer, Uuid::new_v4(), binding, 1, release, &manifest)
                .await
                .is_err()
        );
        assert!(
            materialize(&mut outer, tenant, binding, 2, release, &manifest)
                .await
                .is_err()
        );
        let mut altered = manifest.clone();
        altered["actionDefinitions"][0]["resultExposurePolicy"]["mode"] = json!("EXPORT");
        assert!(
            materialize(&mut outer, tenant, binding, 1, release, &altered)
                .await
                .is_err()
        );
        // Possessing the fixed reference while provisioning grants no execution.
        assert!(validate(
            &mut outer,
            tenant,
            binding,
            1,
            release,
            key,
            1,
            policy,
            1,
            declaration
        )
        .await
        .is_err());
        // Original TEMPORAL admission sets ALLOWED after prewrite, before commit.
        sqlx::query("update admission.action_execution set gate_state='ALLOWED' where id=(
            select action_execution_id from projection.application_runtime where binding_id=$1 and generation=1)")
            .bind(binding).execute(&mut *outer).await.unwrap();
        sqlx::query("update projection.application_runtime set state='ACTIVE',observation=jsonb_build_object(
            'bindingId',binding_id,'nativeScopeRef','isolated-scope','configDigest',repeat('6',64)) where binding_id=$1")
            .bind(binding).execute(&mut *outer).await.unwrap();
        sqlx::query("insert into projection.application_category(tenant_id,category_key,contract_version,binding_id,generation)
            values($1,'retire_plain',1,$2,1)").bind(tenant).bind(binding).execute(&mut *outer).await.unwrap();
        sqlx::query("update catalog.application_binding set state='ACTIVE',version=2,active_projection_generation=1,
            native_scope_ref='isolated-scope' where id=$1").bind(binding).execute(&mut *outer).await.unwrap();
        validate(
            &mut outer,
            tenant,
            binding,
            1,
            release,
            key,
            1,
            policy,
            1,
            declaration,
        )
        .await
        .unwrap();
        for (t, b, g, r, k, v, p, pv) in [
            (Uuid::new_v4(), binding, 1, release, key, 1, policy, 1),
            (tenant, Uuid::new_v4(), 1, release, key, 1, policy, 1),
            (tenant, binding, 2, release, key, 1, policy, 1),
            (tenant, binding, 1, Uuid::new_v4(), key, 1, policy, 1),
            (tenant, binding, 1, release, "other", 1, policy, 1),
            (tenant, binding, 1, release, key, 2, policy, 1),
            (tenant, binding, 1, release, key, 1, Uuid::new_v4(), 1),
            (tenant, binding, 1, release, key, 1, policy, 2),
        ] {
            assert!(validate(&mut outer, t, b, g, r, k, v, p, pv, declaration)
                .await
                .is_err());
        }
        let unrelated = Uuid::new_v4();
        sqlx::query("insert into catalog.result_exposure_policy(id,tenant_id,mode,output_schema_hash,redaction_policy,version,status)
            select $2,tenant_id,mode,output_schema_hash,redaction_policy,1,'ACTIVE' from catalog.result_exposure_policy where id=$1")
            .bind(policy).bind(unrelated).execute(&mut *outer).await.unwrap();
        assert!(validate(
            &mut outer,
            tenant,
            binding,
            1,
            release,
            key,
            1,
            unrelated,
            1,
            declaration
        )
        .await
        .is_err());
        let mut deletion = outer.begin().await.unwrap();
        assert!(
            sqlx::query("delete from catalog.result_exposure_policy where id=$1")
                .bind(policy)
                .execute(&mut *deletion)
                .await
                .is_err()
        );
        deletion.rollback().await.unwrap();
        let mut mutation = outer.begin().await.unwrap();
        assert!(sqlx::query(
            "update catalog.result_exposure_policy set action_key='other' where id=$1"
        )
        .bind(policy)
        .execute(&mut *mutation)
        .await
        .is_err());
        mutation.rollback().await.unwrap();
        sqlx::query("update catalog.result_exposure_policy set status='RETIRED' where id=$1")
            .bind(policy)
            .execute(&mut *outer)
            .await
            .unwrap();
        assert!(validate(
            &mut outer,
            tenant,
            binding,
            1,
            release,
            key,
            1,
            policy,
            1,
            declaration
        )
        .await
        .is_err());
        let mut reactivate = outer.begin().await.unwrap();
        assert!(sqlx::query(
            "update catalog.result_exposure_policy set status='ACTIVE' where id=$1"
        )
        .bind(policy)
        .execute(&mut *reactivate)
        .await
        .is_err());
        reactivate.rollback().await.unwrap();
        outer.rollback().await.unwrap();
    }
}
