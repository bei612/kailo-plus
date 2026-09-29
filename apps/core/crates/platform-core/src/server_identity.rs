//! SERVER 托管的 Buzz 私钥取用边界（DD-70/72）。
//!
//! SecretRef 可读并不证明它属于 binding 中登记的 pubkey：同一 KV locator 的
//! 其他版本、错误的引用或配置漂移都不能让 Core 以另一身份代签。

use kailo_secrets::{SecretError, SecretRef, SecretStore};
use nostr::Keys;

#[derive(Debug, thiserror::Error)]
pub(crate) enum BoundKeyError {
    #[error(transparent)]
    Secret(#[from] SecretError),
    #[error("SERVER 私钥不可解析")]
    InvalidKey,
    #[error("SERVER 私钥与 binding pubkey 不一致")]
    PubkeyMismatch,
}

pub(crate) async fn read_bound_keys(
    store: &SecretStore,
    reference: &SecretRef,
    expected_pubkey: &str,
) -> Result<Keys, BoundKeyError> {
    let value = store.read(reference, "value").await?;
    let keys = Keys::parse(value.expose()).map_err(|_| BoundKeyError::InvalidKey)?;
    if keys.public_key().to_hex() != expected_pubkey {
        return Err(BoundKeyError::PubkeyMismatch);
    }
    Ok(keys)
}
