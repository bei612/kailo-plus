//! DD-135(2)：Skill artifact 格式 `kailo-skill@1` 的唯一编解码。
//!
//! 规范 artifact 恰为一个 UTF-8 `SKILL.md`（去 BOM、换行规范为 LF）。上传只接受裸
//! `SKILL.md`、POSIX tar（ustar/pax/GNU 长名）与其 gzip；一期 SERVER_CODEX 没有文件读取
//! 与 shell（SF-COD-18(5)），其他文件既不会被读取也不会执行，因此一律拒绝并逐项列出。
//! 这里只做纯计算：不落盘、不解出到文件系统，违规只给违规码与包内路径，不回显正文。

use std::io::Read;

use contracts::{SkillArtifactEncoding, SkillArtifactViolationCode as Code};
use serde_yaml::Value as Yaml;
use sha2::{Digest, Sha256};

pub(crate) const FORMAT: &str = "kailo-skill@1";
pub(crate) const SKILL_FILE: &str = "SKILL.md";
pub(crate) const MAX_UPLOAD_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_EXPANDED_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_ENTRIES: usize = 64;
pub(crate) const MAX_SKILL_MD_BYTES: usize = 64 * 1024;
pub(crate) const MAX_DESCRIPTION_CHARS: usize = 1024;
/// 与 Codex `MAX_NAME_LEN` 及 `$name` 字符集相交（SF-COD-18(1)(3)）。
pub(crate) const MAX_SLUG_CHARS: usize = 64;

const BLOCK: usize = 512;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Violation {
    pub code: Code,
    pub path: Option<String>,
}

impl Violation {
    fn new(code: Code, path: Option<&str>) -> Self {
        Self {
            code,
            path: path.map(str::to_owned),
        }
    }
}

/// 一次上传校验通过后的规范 artifact 与 frontmatter 元数据。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Artifact {
    pub encoding: SkillArtifactEncoding,
    pub upload_digest: String,
    pub upload_byte_size: usize,
    pub bytes: Vec<u8>,
    pub digest: String,
    pub name: String,
    pub description: String,
    pub short_description: Option<String>,
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// slug 即 Codex skill 名：小写字母、数字与连字符，首尾为字母或数字，至多 64 字符。
pub(crate) fn valid_slug(slug: &str) -> bool {
    let bytes = slug.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_SLUG_CHARS
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
        && bytes.first().is_some_and(|b| *b != b'-')
        && bytes.last().is_some_and(|b| *b != b'-')
}

/// 上传字节的编码判定；zip 明确拒绝，不猜测其他容器。
fn encoding_of(upload: &[u8]) -> Result<SkillArtifactEncoding, Violation> {
    if upload.starts_with(&[0x1f, 0x8b]) {
        Ok(SkillArtifactEncoding::TarGzip)
    } else if upload.starts_with(b"PK\x03\x04") || upload.starts_with(b"PK\x05\x06") {
        Err(Violation::new(Code::UnsupportedEncoding, None))
    } else if upload.len() >= BLOCK && &upload[257..262] == b"ustar" {
        Ok(SkillArtifactEncoding::Tar)
    } else {
        Ok(SkillArtifactEncoding::SkillMd)
    }
}

/// 校验并规范化一次上传；`slug` 是目标定义的稳定 slug（frontmatter `name` 必须相等）。
pub(crate) fn decode(upload: &[u8], slug: &str) -> Result<Artifact, Vec<Violation>> {
    if upload.is_empty() {
        return Err(vec![Violation::new(Code::MissingSkillMd, None)]);
    }
    if upload.len() > MAX_UPLOAD_BYTES {
        return Err(vec![Violation::new(Code::UploadTooLarge, None)]);
    }
    let encoding = encoding_of(upload).map_err(|v| vec![v])?;
    let skill_md = match encoding {
        SkillArtifactEncoding::SkillMd => upload.to_vec(),
        SkillArtifactEncoding::Tar => single_skill_md(&parse_tar(upload)?)?,
        SkillArtifactEncoding::TarGzip => {
            let mut expanded = Vec::new();
            let read = flate2::read::GzDecoder::new(upload)
                .take(u64::try_from(MAX_EXPANDED_BYTES).unwrap_or(u64::MAX) + 1)
                .read_to_end(&mut expanded);
            if read.is_err() {
                return Err(vec![Violation::new(Code::ArchiveInvalid, None)]);
            }
            if expanded.len() > MAX_EXPANDED_BYTES {
                return Err(vec![Violation::new(Code::ExpandedTooLarge, None)]);
            }
            if expanded.len() < BLOCK || &expanded[257..262] != b"ustar" {
                return Err(vec![Violation::new(Code::ArchiveInvalid, None)]);
            }
            single_skill_md(&parse_tar(&expanded)?)?
        }
    };
    let (bytes, meta) = validate_skill_md(&skill_md, slug)?;
    Ok(Artifact {
        encoding,
        upload_digest: sha256_hex(upload),
        upload_byte_size: upload.len(),
        digest: sha256_hex(&bytes),
        bytes,
        name: meta.name,
        description: meta.description,
        short_description: meta.short_description,
    })
}

#[derive(Debug)]
enum Entry {
    File { path: String, data: Vec<u8> },
    Dir { path: String },
}

fn octal(field: &[u8]) -> Option<u64> {
    let text: Vec<u8> = field
        .iter()
        .copied()
        .take_while(|b| *b != 0)
        .filter(|b| *b != b' ')
        .collect();
    if text.is_empty() {
        return Some(0);
    }
    if !text.iter().all(|b| (b'0'..=b'7').contains(b)) {
        return None;
    }
    u64::from_str_radix(std::str::from_utf8(&text).ok()?, 8).ok()
}

fn cstr(field: &[u8]) -> Option<String> {
    let end = field.iter().position(|b| *b == 0).unwrap_or(field.len());
    String::from_utf8(field[..end].to_vec()).ok()
}

fn checksum_ok(header: &[u8]) -> bool {
    let Some(expected) = octal(&header[148..156]) else {
        return false;
    };
    let sum: u64 = header
        .iter()
        .enumerate()
        .map(|(i, b)| {
            if (148..156).contains(&i) {
                u64::from(b' ')
            } else {
                u64::from(*b)
            }
        })
        .sum();
    sum == expected
}

/// pax 扩展头只取 `path`；记录格式为 `<len> <key>=<value>\n`。
fn pax_path(data: &[u8]) -> Result<Option<String>, ()> {
    let mut rest = data;
    let mut path = None;
    while !rest.is_empty() {
        let space = rest.iter().position(|b| *b == b' ').ok_or(())?;
        let len: usize = std::str::from_utf8(&rest[..space])
            .map_err(|_| ())?
            .parse()
            .map_err(|_| ())?;
        if len <= space + 1 || len > rest.len() || rest[len - 1] != b'\n' {
            return Err(());
        }
        let record = std::str::from_utf8(&rest[space + 1..len - 1]).map_err(|_| ())?;
        let (key, value) = record.split_once('=').ok_or(())?;
        if key == "path" {
            path = Some(value.to_owned());
        }
        rest = &rest[len..];
    }
    Ok(path)
}

/// 包内路径规范化：去掉 `./` 与尾部 `/`；绝对路径、`..`、反斜杠与空组件不安全。
fn normalize(path: &str) -> Option<String> {
    if path.starts_with('/') || path.contains('\\') || path.contains('\0') {
        return None;
    }
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => return None,
            other => parts.push(other),
        }
    }
    Some(parts.join("/"))
}

fn parse_tar(data: &[u8]) -> Result<Vec<Entry>, Vec<Violation>> {
    let mut entries = Vec::new();
    let mut violations = Vec::new();
    let mut pos = 0;
    let mut next_name: Option<String> = None;
    let mut expanded = 0usize;
    let mut counted = 0usize;
    loop {
        if pos + BLOCK > data.len() {
            if data[pos..].iter().any(|b| *b != 0) {
                return Err(vec![Violation::new(Code::ArchiveInvalid, None)]);
            }
            break;
        }
        let header = &data[pos..pos + BLOCK];
        if header.iter().all(|b| *b == 0) {
            break;
        }
        if !checksum_ok(header) {
            return Err(vec![Violation::new(Code::ArchiveInvalid, None)]);
        }
        let size = octal(&header[124..136])
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| vec![Violation::new(Code::ArchiveInvalid, None)])?;
        let mode = octal(&header[100..108])
            .ok_or_else(|| vec![Violation::new(Code::ArchiveInvalid, None)])?;
        let start = pos + BLOCK;
        let padded = size.div_ceil(BLOCK) * BLOCK;
        if start.checked_add(padded).is_none_or(|end| end > data.len()) {
            return Err(vec![Violation::new(Code::ArchiveInvalid, None)]);
        }
        let body = &data[start..start + size];
        pos = start + padded;
        let typeflag = header[156];
        match typeflag {
            b'x' => {
                next_name = pax_path(body)
                    .map_err(|()| vec![Violation::new(Code::ArchiveInvalid, None)])?
                    .or(next_name);
                continue;
            }
            b'g' => continue,
            b'L' => {
                next_name = Some(
                    cstr(body).ok_or_else(|| vec![Violation::new(Code::ArchiveInvalid, None)])?,
                );
                continue;
            }
            _ => {}
        }
        counted += 1;
        if counted > MAX_ENTRIES {
            return Err(vec![Violation::new(Code::EntryLimitExceeded, None)]);
        }
        let raw = match next_name.take() {
            Some(name) => name,
            None => {
                let name = cstr(&header[0..100])
                    .ok_or_else(|| vec![Violation::new(Code::ArchiveInvalid, None)])?;
                let prefix = cstr(&header[345..500]).unwrap_or_default();
                if prefix.is_empty() {
                    name
                } else {
                    format!("{prefix}/{name}")
                }
            }
        };
        let Some(path) = normalize(&raw) else {
            violations.push(Violation::new(Code::UnsafePath, Some(&raw)));
            continue;
        };
        match typeflag {
            b'0' | 0 | b'7' => {
                expanded = expanded.saturating_add(size);
                if expanded > MAX_EXPANDED_BYTES {
                    return Err(vec![Violation::new(Code::ExpandedTooLarge, None)]);
                }
                if mode & 0o111 != 0 {
                    violations.push(Violation::new(Code::ExecutableEntry, Some(&path)));
                }
                entries.push(Entry::File {
                    path,
                    data: body.to_vec(),
                });
            }
            b'5' => {
                if !path.is_empty() {
                    entries.push(Entry::Dir { path });
                }
            }
            b'1' | b'2' => violations.push(Violation::new(Code::LinkEntry, Some(&path))),
            _ => violations.push(Violation::new(Code::SpecialEntry, Some(&path))),
        }
    }
    if violations.is_empty() {
        Ok(entries)
    } else {
        Err(violations)
    }
}

/// 恰有一个 `SKILL.md`，位于根或唯一顶层目录下；其他任何文件或目录都是多余条目。
fn single_skill_md(entries: &[Entry]) -> Result<Vec<u8>, Vec<Violation>> {
    let path_of = |e: &Entry| match e {
        Entry::File { path, .. } | Entry::Dir { path } => path.clone(),
    };
    let top: Option<String> = {
        let firsts: std::collections::BTreeSet<&str> = entries
            .iter()
            .filter_map(|e| match e {
                Entry::File { path, .. } | Entry::Dir { path } => path.split('/').next(),
            })
            .collect();
        let root_file = entries
            .iter()
            .any(|e| matches!(e, Entry::File { path, .. } if !path.contains('/')));
        match (firsts.len(), root_file) {
            (1, false) => firsts.into_iter().next().map(str::to_owned),
            _ => None,
        }
    };
    let relative = |path: &str| -> String {
        match &top {
            Some(top) if path == top => String::new(),
            Some(top) => path
                .strip_prefix(&format!("{top}/"))
                .unwrap_or(path)
                .to_owned(),
            None => path.to_owned(),
        }
    };
    let mut violations = Vec::new();
    let mut found: Option<&[u8]> = None;
    for entry in entries {
        let rel = relative(&path_of(entry));
        match entry {
            Entry::Dir { .. } if rel.is_empty() => {}
            Entry::File { data, .. } if rel == SKILL_FILE => {
                if found.is_some() {
                    violations.push(Violation::new(
                        Code::DuplicateSkillMd,
                        Some(&path_of(entry)),
                    ));
                } else {
                    found = Some(data.as_slice());
                }
            }
            _ => violations.push(Violation::new(Code::ExtraEntry, Some(&path_of(entry)))),
        }
    }
    if found.is_none() {
        violations.push(Violation::new(Code::MissingSkillMd, None));
    }
    match (found, violations.is_empty()) {
        (Some(data), true) => Ok(data.to_vec()),
        _ => Err(violations),
    }
}

struct Frontmatter {
    name: String,
    description: String,
    short_description: Option<String>,
}

/// 与 Codex `sanitize_single_line` 同向：折叠空白为单行。
fn single_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn validate_skill_md(raw: &[u8], slug: &str) -> Result<(Vec<u8>, Frontmatter), Vec<Violation>> {
    let at = Some(SKILL_FILE);
    if raw.len() > MAX_SKILL_MD_BYTES + 3 {
        return Err(vec![Violation::new(Code::SkillMdTooLarge, at)]);
    }
    let raw = raw.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(raw);
    let Ok(text) = std::str::from_utf8(raw) else {
        return Err(vec![Violation::new(Code::NotUtf8, at)]);
    };
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    if text
        .chars()
        .any(|c| (c.is_control() && c != '\n' && c != '\t') || c == '\u{feff}')
    {
        return Err(vec![Violation::new(Code::ControlCharacter, at)]);
    }
    if text.len() > MAX_SKILL_MD_BYTES {
        return Err(vec![Violation::new(Code::SkillMdTooLarge, at)]);
    }
    let mut lines = text.split('\n');
    if lines.next() != Some("---") {
        return Err(vec![Violation::new(Code::MissingFrontmatter, at)]);
    }
    let mut yaml = Vec::new();
    let mut closed = false;
    for line in lines {
        if line == "---" {
            closed = true;
            break;
        }
        yaml.push(line);
    }
    if !closed {
        return Err(vec![Violation::new(Code::MissingFrontmatter, at)]);
    }
    let Ok(Yaml::Mapping(map)) = serde_yaml::from_str::<Yaml>(&yaml.join("\n")) else {
        return Err(vec![Violation::new(Code::InvalidFrontmatter, at)]);
    };
    let mut violations = Vec::new();
    let mut name = None;
    let mut description = None;
    let mut short_description = None;
    for (key, value) in &map {
        let Some(key) = key.as_str() else {
            violations.push(Violation::new(Code::InvalidFrontmatter, at));
            continue;
        };
        let field = format!("{SKILL_FILE}#{key}");
        match (key, value) {
            ("name", Yaml::String(v)) => name = Some(single_line(v)),
            ("description", Yaml::String(v)) => description = Some(single_line(v)),
            ("license", Yaml::String(_)) => {}
            ("metadata", Yaml::Mapping(meta)) => {
                for (k, v) in meta {
                    match (k.as_str(), v) {
                        (Some("short-description"), Yaml::String(v)) => {
                            short_description = Some(single_line(v))
                        }
                        (Some(k), _) => violations.push(Violation::new(
                            Code::UnsupportedFrontmatterKey,
                            Some(&format!("{field}.{k}")),
                        )),
                        (None, _) => violations.push(Violation::new(Code::InvalidFrontmatter, at)),
                    }
                }
            }
            ("name" | "description" | "license" | "metadata", _) => {
                violations.push(Violation::new(Code::InvalidFrontmatter, Some(&field)))
            }
            _ => violations.push(Violation::new(
                Code::UnsupportedFrontmatterKey,
                Some(&field),
            )),
        }
    }
    if name.as_deref() != Some(slug) {
        violations.push(Violation::new(Code::NameMismatch, Some("SKILL.md#name")));
    }
    let description = description.unwrap_or_default();
    if description.is_empty() {
        violations.push(Violation::new(
            Code::MissingDescription,
            Some("SKILL.md#description"),
        ));
    } else if description.chars().count() > MAX_DESCRIPTION_CHARS {
        violations.push(Violation::new(
            Code::DescriptionTooLong,
            Some("SKILL.md#description"),
        ));
    }
    match short_description.as_deref() {
        Some("") => violations.push(Violation::new(
            Code::InvalidFrontmatter,
            Some("SKILL.md#metadata.short-description"),
        )),
        Some(s) if s.chars().count() > MAX_DESCRIPTION_CHARS => violations.push(Violation::new(
            Code::DescriptionTooLong,
            Some("SKILL.md#metadata.short-description"),
        )),
        _ => {}
    }
    if !violations.is_empty() {
        return Err(violations);
    }
    Ok((
        text.into_bytes(),
        Frontmatter {
            name: slug.to_owned(),
            description,
            short_description,
        },
    ))
}

/// 规范元数据摘要：名称、说明、短说明与能力需求的规范 JSON SHA-256（03 §7 `metadata_hash`）。
pub(crate) fn metadata_hash(
    name: &str,
    description: &str,
    short_description: Option<&str>,
    capability_requirements: &[String],
) -> String {
    let value = crate::agent_version::canonical(serde_json::json!({
        "name": name,
        "description": description,
        "shortDescription": short_description,
        "capabilityRequirements": capability_requirements,
    }));
    sha256_hex(&serde_json::to_vec(&value).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str =
        "---\nname: release-notes\ndescription: Write release notes.\n---\n\n# Release notes\n";

    fn header(path: &str, size: usize, mode: u32, typeflag: u8) -> Vec<u8> {
        let mut h = vec![0u8; BLOCK];
        h[..path.len()].copy_from_slice(path.as_bytes());
        h[100..107].copy_from_slice(format!("{mode:07o}").as_bytes());
        h[108..115].copy_from_slice(b"0000000");
        h[116..123].copy_from_slice(b"0000000");
        h[124..135].copy_from_slice(format!("{size:011o}").as_bytes());
        h[136..147].copy_from_slice(b"00000000000");
        h[156] = typeflag;
        h[257..263].copy_from_slice(b"ustar\0");
        h[263..265].copy_from_slice(b"00");
        h[148..156].copy_from_slice(b"        ");
        let sum: u32 = h.iter().map(|b| u32::from(*b)).sum();
        h[148..155].copy_from_slice(format!("{sum:06o}\0").as_bytes());
        h
    }

    fn tar(entries: &[(&str, &[u8], u32, u8)]) -> Vec<u8> {
        let mut out = Vec::new();
        for (path, data, mode, flag) in entries {
            out.extend(header(path, data.len(), *mode, *flag));
            out.extend_from_slice(data);
            out.resize(out.len().div_ceil(BLOCK) * BLOCK, 0);
        }
        out.extend(vec![0u8; BLOCK * 2]);
        out
    }

    fn codes(result: Result<Artifact, Vec<Violation>>) -> Vec<Code> {
        result.unwrap_err().into_iter().map(|v| v.code).collect()
    }

    #[test]
    fn bare_tar_and_gzip_uploads_share_one_canonical_digest() {
        let bare = decode(GOOD.as_bytes(), "release-notes").unwrap();
        assert_eq!(bare.encoding, SkillArtifactEncoding::SkillMd);
        assert_eq!(bare.description, "Write release notes.");
        let crlf = GOOD.replace('\n', "\r\n");
        let with_bom = [b"\xEF\xBB\xBF".as_slice(), crlf.as_bytes()].concat();
        assert_eq!(
            decode(&with_bom, "release-notes").unwrap().digest,
            bare.digest
        );
        let archive = tar(&[
            ("release-notes/", b"", 0o755, b'5'),
            ("release-notes/SKILL.md", GOOD.as_bytes(), 0o644, b'0'),
        ]);
        let from_tar = decode(&archive, "release-notes").unwrap();
        assert_eq!(from_tar.encoding, SkillArtifactEncoding::Tar);
        assert_eq!(from_tar.digest, bare.digest);
        assert_ne!(from_tar.upload_digest, bare.upload_digest);
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut gz, &archive).unwrap();
        let from_gz = decode(&gz.finish().unwrap(), "release-notes").unwrap();
        assert_eq!(from_gz.encoding, SkillArtifactEncoding::TarGzip);
        assert_eq!(from_gz.bytes, bare.bytes);
        let root = tar(&[("SKILL.md", GOOD.as_bytes(), 0o644, b'0')]);
        assert_eq!(decode(&root, "release-notes").unwrap().digest, bare.digest);
    }

    #[test]
    fn archives_with_anything_but_one_plain_skill_md_are_rejected_per_entry() {
        let links = tar(&[
            ("s/SKILL.md", GOOD.as_bytes(), 0o644, b'0'),
            ("s/link", b"", 0o777, b'2'),
            ("s/dev", b"", 0o644, b'3'),
            ("../escape", b"x", 0o644, b'0'),
        ]);
        assert_eq!(
            codes(decode(&links, "release-notes")),
            vec![Code::LinkEntry, Code::SpecialEntry, Code::UnsafePath]
        );
        let script = tar(&[
            ("s/SKILL.md", GOOD.as_bytes(), 0o644, b'0'),
            ("s/scripts/run.sh", b"#!/bin/sh\n", 0o755, b'0'),
        ]);
        assert_eq!(
            codes(decode(&script, "release-notes")),
            vec![Code::ExecutableEntry]
        );
        let extra = tar(&[
            ("s/SKILL.md", GOOD.as_bytes(), 0o644, b'0'),
            ("s/references/a.png", &[0x89, b'P', b'N', b'G'], 0o644, b'0'),
        ]);
        let rejected = decode(&extra, "release-notes").unwrap_err();
        assert_eq!(
            rejected,
            vec![Violation::new(Code::ExtraEntry, Some("s/references/a.png"))]
        );
        let none = tar(&[("s/README.md", b"x", 0o644, b'0')]);
        assert!(codes(decode(&none, "release-notes")).contains(&Code::MissingSkillMd));
        let two_tops = tar(&[
            ("a/SKILL.md", GOOD.as_bytes(), 0o644, b'0'),
            ("b/SKILL.md", GOOD.as_bytes(), 0o644, b'0'),
        ]);
        assert!(codes(decode(&two_tops, "release-notes")).contains(&Code::MissingSkillMd));
        assert_eq!(
            codes(decode(b"PK\x03\x04rest", "release-notes")),
            vec![Code::UnsupportedEncoding]
        );
        assert_eq!(
            codes(decode(&vec![b'a'; MAX_UPLOAD_BYTES + 1], "release-notes")),
            vec![Code::UploadTooLarge]
        );
        let mut corrupt = tar(&[("SKILL.md", GOOD.as_bytes(), 0o644, b'0')]);
        corrupt[0] ^= 1;
        assert_eq!(
            codes(decode(&corrupt, "release-notes")),
            vec![Code::ArchiveInvalid]
        );
    }

    #[test]
    fn skill_md_frontmatter_follows_the_codex_contract_and_the_slug() {
        assert_eq!(
            codes(decode(b"# no frontmatter\n", "release-notes")),
            vec![Code::MissingFrontmatter]
        );
        assert_eq!(
            codes(decode(
                b"---\nname: other\ndescription: d\n---\n",
                "release-notes"
            )),
            vec![Code::NameMismatch]
        );
        assert_eq!(
            codes(decode(b"---\nname: release-notes\n---\n", "release-notes")),
            vec![Code::MissingDescription]
        );
        let long = format!(
            "---\nname: release-notes\ndescription: {}\n---\n",
            "x".repeat(1025)
        );
        assert_eq!(
            codes(decode(long.as_bytes(), "release-notes")),
            vec![Code::DescriptionTooLong]
        );
        assert_eq!(
            codes(decode(
                b"---\nname: release-notes\ndescription: d\nallowed-tools: [Bash]\n---\n",
                "release-notes"
            )),
            vec![Code::UnsupportedFrontmatterKey]
        );
        assert_eq!(
            codes(decode(
                b"---\nname: release-notes\ndescription: d\n---\n\0",
                "release-notes"
            )),
            vec![Code::ControlCharacter]
        );
        assert_eq!(
            codes(decode(&[0xff, 0xfe, 0x00], "release-notes")),
            vec![Code::NotUtf8]
        );
        let big = format!(
            "---\nname: release-notes\ndescription: d\n---\n{}",
            "x".repeat(MAX_SKILL_MD_BYTES)
        );
        assert_eq!(
            codes(decode(big.as_bytes(), "release-notes")),
            vec![Code::SkillMdTooLarge]
        );
        let ok = decode(
            b"---\nname: release-notes\ndescription:   Write\n  notes.\nlicense: MIT\nmetadata:\n  short-description: Notes\n---\nbody\n",
            "release-notes",
        )
        .unwrap();
        assert_eq!(ok.description, "Write notes.");
        assert_eq!(ok.short_description.as_deref(), Some("Notes"));
    }

    #[test]
    fn slugs_are_the_codex_mention_safe_subset() {
        for ok in ["a", "release-notes", "a1", &"a".repeat(64)] {
            assert!(valid_slug(ok), "{ok}");
        }
        for bad in ["", "-a", "a-", "A", "a_b", "a.b", "a b", &"a".repeat(65)] {
            assert!(!valid_slug(bad), "{bad}");
        }
    }

    #[test]
    fn metadata_hash_is_independent_of_key_order_and_covers_requirements() {
        let a = metadata_hash("n", "d", None, &[]);
        assert_eq!(a, metadata_hash("n", "d", None, &[]));
        assert_ne!(a, metadata_hash("n", "d", None, &["k@v1".into()]));
        assert_ne!(a, metadata_hash("n", "d", Some("s"), &[]));
    }
}
