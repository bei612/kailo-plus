use super::*;
use nostr::{EventBuilder, Kind, Tag};

fn roster(author: &Keys, members: &[&str]) -> nostr::Event {
    let mut builder = EventBuilder::new(Kind::Custom(39002), "").tag(Tag::parse(["d", "chan"]).unwrap());
    for member in members {
        builder = builder.tag(Tag::parse(["p", member]).unwrap());
    }
    builder.sign_with_keys(author).unwrap()
}

#[test]
fn only_explicit_refusals_revoke_and_transient_errors_keep_data() {
    assert_eq!(classify_relay_error("relay returned 403 Forbidden: denied"), Access::Lost);
    assert_eq!(classify_relay_error("relay returned 401 Unauthorized"), Access::IdentityRejected);
    assert_eq!(classify_relay_error("relay returned 500 Internal Server Error"), Access::Unknown);
    assert_eq!(classify_relay_error("relay returned 429 Too Many Requests"), Access::Unknown);
    assert_eq!(classify_relay_error("request timed out"), Access::Unknown);
}

#[test]
fn roster_membership_decides_access() {
    let owner = Keys::generate();
    let me = Keys::generate().public_key().to_hex();
    assert_eq!(access_from_roster(&[roster(&owner, &[&me])], false, &me), Access::Readable);
    assert_eq!(access_from_roster(&[roster(&owner, &["ab"])], false, &me), Access::Lost);
    assert_eq!(access_from_roster(&[], true, &me), Access::Readable);
    assert_eq!(access_from_roster(&[], false, &me), Access::Lost);
}

#[test]
fn other_identities_archives_are_erased_key_first() {
    let dir = tempfile::tempdir().unwrap();
    let mine = identity_tag("aa");
    let theirs = identity_tag("bb");
    for tag in [&mine, &theirs] {
        std::fs::write(dir.path().join(format!("{tag}.sqlite")), b"x").unwrap();
    }
    std::fs::write(dir.path().join("notes.txt"), b"x").unwrap();
    let deleted = std::cell::RefCell::new(Vec::new());
    erase_foreign(dir.path(), &mine, &|name| {
        deleted.borrow_mut().push(name.to_string());
        Ok(())
    });
    assert_eq!(deleted.into_inner(), vec![key_name(&theirs)]);
    assert!(dir.path().join(format!("{mine}.sqlite")).exists());
    assert!(!dir.path().join(format!("{theirs}.sqlite")).exists());
    assert!(dir.path().join("notes.txt").exists());
}

#[test]
fn a_file_is_kept_when_its_key_cannot_be_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let theirs = identity_tag("bb");
    std::fs::write(dir.path().join(format!("{theirs}.sqlite")), b"x").unwrap();
    erase_foreign(dir.path(), &identity_tag("aa"), &|_| Err("locked".into()));
    assert!(dir.path().join(format!("{theirs}.sqlite")).exists());
}
