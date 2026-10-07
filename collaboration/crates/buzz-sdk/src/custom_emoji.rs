//! Same deterministic palette as the original desktop customEmoji.ts and CLI
//! commands/emoji.rs at 779af8886caae1317b4de962082429867ab61503.
use crate::{normalize_custom_emoji_shortcode, CustomEmoji, CUSTOM_EMOJI_SET_D_TAG};
use nostr::Event;
use std::collections::BTreeMap;

/// Verify signed per-author sets and resolve original newest/URL-tie winners.
pub fn custom_emoji_palette(events: &[Event]) -> Result<Vec<CustomEmoji>, &'static str> {
    let mut palette = BTreeMap::<String, (u64, String)>::new();
    for event in events {
        if event.kind.as_u16() as u32 != buzz_core::kind::KIND_EMOJI_SET
            || event.tags.identifier() != Some(CUSTOM_EMOJI_SET_D_TAG)
            || event.verify().is_err()
        {
            return Err("invalid signed emoji set");
        }
        let mut seen = std::collections::HashSet::new();
        for tag in event.tags.iter().map(|tag| tag.as_slice()) {
            if tag.first().map(String::as_str) != Some("emoji") {
                continue;
            }
            let (Some(name), Some(url)) = (tag.get(1), tag.get(2)) else {
                continue;
            };
            let Ok(name) = normalize_custom_emoji_shortcode(name) else {
                continue;
            };
            if !seen.insert(name.clone()) {
                continue;
            }
            let created = event.created_at.as_secs();
            if palette.get(&name).is_none_or(|(old_created, old_url)| {
                created > *old_created || created == *old_created && url < old_url
            }) {
                palette.insert(name, (created, url.clone()));
            }
        }
    }
    Ok(palette
        .into_iter()
        .map(|(shortcode, (_, url))| CustomEmoji { shortcode, url })
        .collect())
}

/// Attach original NIP-30 tags only for shortcodes actually used in the message.
pub fn custom_emoji_tags(
    content: &str,
    events: &[Event],
) -> Result<Vec<Vec<String>>, &'static str> {
    let content = content.to_ascii_lowercase();
    Ok(custom_emoji_palette(events)?
        .into_iter()
        .filter(|emoji| content.contains(&format!(":{}:", emoji.shortcode)))
        .map(|emoji| vec!["emoji".into(), emoji.shortcode, emoji.url])
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build_custom_emoji_set;

    fn event(keys: &nostr::Keys, url: &str, created_at: u64) -> Event {
        build_custom_emoji_set(&[CustomEmoji {
            shortcode: "joy".into(),
            url: url.into(),
        }])
        .unwrap()
        .custom_created_at(nostr::Timestamp::from(created_at))
        .sign_with_keys(keys)
        .unwrap()
    }

    #[test]
    fn custom_emoji_signed_palette_preserves_original_collision_rule_and_message_tags() {
        let first = event(&nostr::Keys::generate(), "https://b.example/emoji", 1);
        let second = event(&nostr::Keys::generate(), "https://a.example/emoji", 1);
        let tags = custom_emoji_tags(":JOY: :unknown:", &[first.clone(), second.clone()]).unwrap();
        assert_eq!(tags, vec![vec!["emoji", "joy", "https://a.example/emoji"]]);
        assert_eq!(tags, custom_emoji_tags(":joy:", &[second, first]).unwrap());
        assert!(custom_emoji_tags("plain text", &[]).unwrap().is_empty());
    }

    #[test]
    fn custom_emoji_palette_rejects_changed_signature_and_foreign_kind() {
        let mut signed = event(&nostr::Keys::generate(), "https://a.example/emoji", 1);
        signed.content.push_str("tampered");
        assert!(custom_emoji_palette(&[signed]).is_err());
        let other = nostr::EventBuilder::text_note(":joy:")
            .sign_with_keys(&nostr::Keys::generate())
            .unwrap();
        assert!(custom_emoji_palette(&[other]).is_err());
    }
}
