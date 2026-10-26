//! DD-151 uses the existing Buzz composite cursor, not an independent Relay read authority.
use std::collections::BTreeSet;
use std::time::Duration;
use collab_bridge::{bridge::IdentityClient,operator::OperatorError};
use serde_json::json;
use uuid::Uuid;
use super::{config::Policy,decide::{self,MessageFacts},intent};

pub(super) struct Window<'a> {
 pub pool:&'a sqlx::PgPool, pub tenant:Uuid, pub lease:Uuid, pub since:i64,
 pub seen:BTreeSet<String>, pub until:i64,
}
impl Window<'_> {
 pub(super) async fn run(&self,client:&IdentityClient,http:&reqwest::Client,policy:&Policy,page_size:usize,targets:&[(&str,String)]) -> Result<(), &'static str> {
  let values=buzz_core::relay::query_raw_all(json!({"kinds":decide::MESSAGE_KINDS,"since":self.since,"until":self.until}),page_size,policy.scan_event_bound,|filter|async move {
   if !intent::renew_scan(self.pool,self.tenant,self.lease,policy).await.map_err(|_|OperatorError::Sign("push scan lease unavailable".into()))? {
    return Err(OperatorError::Sign("push scan lease lost".into()))
   }
   tokio::time::timeout(Duration::from_secs(policy.relay_read_timeout_seconds as u64),client.query(http,&[filter])).await
    .map_err(|_|OperatorError::Sign("push Relay read timed out".into()))?
  }).await.map_err(|error|match error {
   buzz_core::relay::QueryAllError::Query(_)=>"RELAY_OR_LEASE_UNAVAILABLE",
   buzz_core::relay::QueryAllError::InvalidPage=>"INVALID_RELAY_PAGE",
   buzz_core::relay::QueryAllError::BoundExceeded=>"SCAN_BOUND_EXCEEDED",
  })?;
  // No checkpoint, partial enqueue or provider call occurs before exhaustive validation.
  let mut messages=Vec::new();
  for value in values {
   let event:nostr::Event=serde_json::from_value(value.clone()).map_err(|_|"INVALID_RELAY_EVENT")?;
   event.verify().map_err(|_|"INVALID_RELAY_EVENT")?;
   let message=MessageFacts::from_event(&value).ok_or("INVALID_RELAY_EVENT")?;
   if message.created_at<self.since as u64 || message.created_at>self.until as u64 {return Err("EVENT_OUTSIDE_WINDOW")}
   if !(message.created_at as i64==self.since && self.seen.contains(&message.id)) {messages.push(message)}
  }
  messages.sort_by(|a,b|(a.created_at,&a.id).cmp(&(b.created_at,&b.id)));
  for message in &messages {
   if !intent::enqueue(self.pool,self.tenant,self.lease,message,targets,policy).await.map_err(|_|"ENQUEUE_UNAVAILABLE")? {return Err("SCAN_LEASE_LOST")}
  }
  let newest=messages.last().map_or(self.since,|m|m.created_at as i64);
  let mut at_newest:Vec<String>=messages.iter().filter(|m|m.created_at as i64==newest).map(|m|m.id.clone()).collect();
  if newest==self.since {at_newest.extend(self.seen.iter().cloned())}
  if !intent::checkpoint_scan(self.pool,self.tenant,self.lease,newest,&at_newest).await.map_err(|_|"CHECKPOINT_UNAVAILABLE")? {return Err("SCAN_LEASE_LOST")}
  Ok(())
 }
}
