//! Compile-time identity for reusable named demo builds.
//!
//! Production builds leave `BUZZ_DESKTOP_BUILD_DEMO_SLUG` unset and retain all
//! existing names. The demo recipe validates one slug and `build.rs` bakes it
//! into the binary; every runtime identity is then derived from that one value.

use std::borrow::Cow;

pub(crate) fn demo_slug() -> Option<&'static str> {
    option_env!("BUZZ_DESKTOP_BUILD_DEMO_SLUG")
}

pub(crate) fn is_demo_build() -> bool {
    demo_slug().is_some()
}

pub(crate) fn deep_link_scheme() -> Cow<'static, str> {
    demo_slug()
        .map(|slug| Cow::Owned(format!("buzz-demo-{slug}")))
        .unwrap_or(Cow::Borrowed("buzz"))
}

pub(crate) fn is_deep_link_for_build(value: &str) -> bool {
    is_deep_link_for_scheme(value, deep_link_scheme().as_ref())
}

fn is_deep_link_for_scheme(value: &str, scheme: &str) -> bool {
    value
        .strip_prefix(scheme)
        .is_some_and(|suffix| suffix.starts_with("://"))
}

pub(crate) fn keyring_service() -> Cow<'static, str> {
    demo_slug()
        .map(|slug| Cow::Owned(format!("buzz-desktop-demo.{slug}")))
        .unwrap_or(Cow::Borrowed("buzz-desktop"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "compiled with BUZZ_BUILD_DEMO_SLUG by the compiled-flags recipe"]
    fn compiled_demo_slug_matches_expected() {
        let expected = std::env::var("BUZZ_TEST_EXPECTED_DEMO_SLUG")
            .expect("BUZZ_TEST_EXPECTED_DEMO_SLUG must be set");
        assert_eq!(demo_slug(), Some(expected.as_str()));
    }

    #[test]
    fn ordinary_release_defaults_remain_production_identity() {
        if demo_slug().is_none() {
            assert_eq!(deep_link_scheme(), "buzz");
            assert_eq!(keyring_service(), "buzz-desktop");
        }
    }

    #[test]
    fn duplicate_instance_links_follow_the_build_scheme() {
        assert!(is_deep_link_for_scheme("buzz://message?id=1", "buzz"));
        assert!(!is_deep_link_for_scheme(
            "buzz-demo-board-1234567812345678://message?id=1",
            "buzz"
        ));
        assert!(is_deep_link_for_scheme(
            "buzz-demo-board-1234567812345678://message?id=1",
            "buzz-demo-board-1234567812345678"
        ));
        assert!(!is_deep_link_for_scheme(
            "buzz://message?id=1",
            "buzz-demo-board-1234567812345678"
        ));
    }
}
