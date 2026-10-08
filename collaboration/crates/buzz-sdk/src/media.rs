//! Original Buzz image preparation, shared by Native and the BFF host.
//! Source: 779af8886caae1317b4de962082429867ab61503, desktop/src-tauri/src/commands/media.rs.

mod media_animated;
mod media_gif;
mod media_snapshot_png;

/// Return true when a PNG/WebP payload declares animation.
///
/// Animated payloads use structural sanitizers so frame timing, looping, and
/// disposal semantics are preserved without flattening the image. The relay's
/// validator remains the final authority for the sanitized container.
fn is_animated_image(body: &[u8], mime: &str) -> bool {
    match mime {
        "image/png" if body.starts_with(b"\x89PNG\r\n\x1a\n") => {
            let mut offset = 8usize;
            while offset.checked_add(12).is_some_and(|end| end <= body.len()) {
                let length = u32::from_be_bytes([
                    body[offset],
                    body[offset + 1],
                    body[offset + 2],
                    body[offset + 3],
                ]) as usize;
                let Some(end) = offset.checked_add(12).and_then(|v| v.checked_add(length)) else {
                    return false;
                };
                if end > body.len() {
                    return false;
                }
                if &body[offset + 4..offset + 8] == b"acTL" {
                    return true;
                }
                offset = end;
            }
            false
        }
        "image/webp"
            if body.len() >= 12 && body.starts_with(b"RIFF") && &body[8..12] == b"WEBP" =>
        {
            let mut offset = 12usize;
            while offset.checked_add(8).is_some_and(|end| end <= body.len()) {
                let chunk = &body[offset..offset + 4];
                if chunk == b"ANIM" || chunk == b"ANMF" {
                    return true;
                }
                let length = u32::from_le_bytes([
                    body[offset + 4],
                    body[offset + 5],
                    body[offset + 6],
                    body[offset + 7],
                ]) as usize;
                let padded = length.checked_add(length & 1);
                let Some(end) = padded.and_then(|v| offset.checked_add(8 + v)) else {
                    return false;
                };
                if end > body.len() {
                    return false;
                }
                offset = end;
            }
            false
        }
        _ => false,
    }
}

/// Remove metadata without losing static EXIF orientation or animated frame semantics.
pub fn sanitize_image_for_upload(body: Vec<u8>, mime: &str) -> Result<Vec<u8>, String> {
    let format = match mime {
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/png" => image::ImageFormat::Png,
        "image/webp" => image::ImageFormat::WebP,
        // GIF is never re-encoded (that would destroy animation timing);
        // metadata extensions are stripped structurally instead. Unparseable
        // payloads pass through — the relay's validator is the authority.
        "image/gif" => {
            let stripped = media_gif::strip_gif_metadata(&body);
            return Ok(stripped.unwrap_or(body));
        }
        _ => return Ok(body),
    };

    if is_animated_image(&body, mime) {
        let oriented_format = match mime {
            "image/png" if media_animated::animated_png_uses_exif_orientation(&body) => Some("PNG"),
            "image/webp" if media_animated::animated_webp_uses_exif_orientation(&body) => {
                Some("WebP")
            }
            _ => None,
        };
        if let Some(format) = oriented_format {
            return Err(format!(
                "animated {format} with EXIF orientation cannot be uploaded without changing its appearance"
            ));
        }
        let color_profile_format = match mime {
            "image/png" if media_animated::animated_png_uses_icc_profile(&body) => Some("PNG"),
            "image/webp" if media_animated::animated_webp_uses_icc_profile(&body) => Some("WebP"),
            _ => None,
        };
        if let Some(format) = color_profile_format {
            return Err(format!(
                "animated {format} with an ICC profile cannot be uploaded without changing its colors"
            ));
        }
        let stripped = match mime {
            "image/png" => media_animated::strip_animated_png_metadata(&body),
            "image/webp" => media_animated::strip_animated_webp_metadata(&body),
            _ => None,
        };
        return Ok(stripped.unwrap_or(body));
    }

    // Agent/team snapshot PNGs carry their manifest in a tEXt chunk that the
    // re-encode below would destroy. Pull it out first and re-inject it after
    // sanitizing — all other metadata is still stripped, and the relay
    // allowlists exactly this chunk.
    let snapshot_chunk = if format == image::ImageFormat::Png {
        media_snapshot_png::extract_snapshot_text_chunk(&body)
    } else {
        None
    };

    use image::ImageDecoder;
    let reader = image::ImageReader::with_format(std::io::Cursor::new(&body), format);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| "failed to decode image for metadata removal".to_string())?;
    decoder
        .set_limits(image::Limits::default())
        .map_err(|_| "image exceeds safe decoding limits".to_string())?;
    let orientation = decoder
        .orientation()
        .map_err(|_| "failed to read image orientation".to_string())?;
    let mut image = image::DynamicImage::from_decoder(decoder)
        .map_err(|_| "failed to decode image for metadata removal".to_string())?;
    image.apply_orientation(orientation);
    let mut output = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut output, format)
        .map_err(|_| "failed to encode image without metadata".to_string())?;
    let sanitized = output.into_inner();
    match snapshot_chunk {
        Some(chunk) => media_snapshot_png::inject_snapshot_text_chunk(sanitized, &chunk),
        None => Ok(sanitized),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_sanitizer_bakes_exif_orientation() {
        let source = image::RgbImage::from_fn(2, 3, |x, y| {
            image::Rgb([(x * 80) as u8, (y * 60) as u8, 32])
        });
        let mut encoded = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 95)
            .encode_image(&source)
            .unwrap();

        // Minimal little-endian Exif IFD with Orientation=6 (rotate 90°).
        let mut exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0".to_vec();
        exif.extend_from_slice(&[
            0x12, 0x01, // Orientation tag
            0x03, 0x00, // SHORT
            0x01, 0x00, 0x00, 0x00, // count=1
            0x06, 0x00, 0x00, 0x00, // value=6
            0x00, 0x00, 0x00, 0x00, // next IFD
        ]);
        let segment_len = (exif.len() + 2) as u16;
        let mut oriented = encoded[..2].to_vec();
        oriented.extend_from_slice(&[0xff, 0xe1]);
        oriented.extend_from_slice(&segment_len.to_be_bytes());
        oriented.extend_from_slice(&exif);
        oriented.extend_from_slice(&encoded[2..]);

        let sanitized = sanitize_image_for_upload(oriented, "image/jpeg").unwrap();
        let decoded =
            image::load_from_memory_with_format(&sanitized, image::ImageFormat::Jpeg).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (3, 2));
        assert!(!sanitized.windows(6).any(|bytes| bytes == b"Exif\0\0"));
    }

    #[test]
    fn test_animated_png_and_webp_are_not_flattened() {
        let mut apng = b"\x89PNG\r\n\x1a\n".to_vec();
        apng.extend_from_slice(&8u32.to_be_bytes());
        apng.extend_from_slice(b"acTL");
        apng.extend_from_slice(&[0; 8]);
        apng.extend_from_slice(&[0; 4]);
        assert!(is_animated_image(&apng, "image/png"));
        assert!(sanitize_image_for_upload(apng, "image/png").is_ok());

        let mut webp = b"RIFF\x0c\0\0\0WEBPANIM".to_vec();
        webp.extend_from_slice(&0u32.to_le_bytes());
        assert!(is_animated_image(&webp, "image/webp"));
        assert!(sanitize_image_for_upload(webp, "image/webp").is_ok());
    }
}
