//! The preview picture Blender keeps near the start of each `.blend` file (the one its file
//! browser shows), read without Blender: the file may be compressed (gzip before Blender
//! 3.0, zstd since), and only its start is unpacked.
//!
//! A `.blend` file is a header, then blocks: each a small head (a four-letter code, the
//! length of what follows, …) and its data. The preview is the `TEST` block, right after
//! the first one: its width and height, then its pixels, RGBA, bottom row first.

use std::io::Read;

use image::RgbaImage;

/// The preview is in the first blocks: at most this much is unpacked to find it.
const LOOK_IN: u64 = 16 * 1024 * 1024;
/// Blender's previews are 128 or 256 pixels across; anything much bigger isn't one.
const BIGGEST: u32 = 1024;

/// How the file's block heads are laid out, from its header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Layout {
    /// Where the first block starts.
    header: usize,
    /// The size of each block's head.
    head: usize,
    little_endian: bool,
    /// Blender 5.0's file format: lengths are 64-bit, and come after the struct index.
    large: bool,
    pointer: usize,
}

/// The layout from a file's first bytes: "BLENDER-v300" (8-byte pointers, little-endian,
/// version 3.0) up to 4.x, or "BLENDER17-01v0500" from 5.0 (a 17-byte header, format 1).
fn layout(start: &[u8]) -> Option<Layout> {
    let rest = start.strip_prefix(b"BLENDER")?;
    match rest {
        [size @ (b'_' | b'-'), endian @ (b'v' | b'V'), ..] => {
            let pointer = if *size == b'_' { 4 } else { 8 };
            Some(Layout {
                header: 12,
                head: 4 + 4 + pointer + 4 + 4,
                little_endian: *endian == b'v',
                large: false,
                pointer,
            })
        }
        [a, b, b'-', f1, f2, endian @ (b'v' | b'V'), ..]
            if a.is_ascii_digit() && b.is_ascii_digit() =>
        {
            let header = usize::from(a - b'0') * 10 + usize::from(b - b'0');
            // Format 1: code, struct index, pointer (8), length (8), count (8).
            (*f1 == b'0' && *f2 == b'1').then_some(Layout {
                header,
                head: 4 + 4 + 8 + 8 + 8,
                little_endian: *endian == b'v',
                large: true,
                pointer: 8,
            })
        }
        _ => None,
    }
}

fn number(bytes: &[u8], little_endian: bool) -> u64 {
    let mut value = 0u64;
    let ordered: Vec<u8> = if little_endian {
        bytes.iter().rev().copied().collect()
    } else {
        bytes.to_vec()
    };
    for byte in ordered {
        value = (value << 8) | u64::from(byte);
    }
    value
}

/// The `TEST` block's data in an unpacked file's start, if it's there.
fn preview_block(data: &[u8]) -> Result<Option<&[u8]>, String> {
    let layout = layout(data).ok_or("Not a Blender file Tributary can read")?;
    let mut at = layout.header;
    // The preview comes right after the render settings: a few blocks in at most.
    for _ in 0..64 {
        let Some(head) = data.get(at..at + layout.head) else {
            return Ok(None);
        };
        let code = &head[..4];
        let length = if layout.large {
            number(
                &head[8 + layout.pointer..16 + layout.pointer],
                layout.little_endian,
            )
        } else {
            number(&head[4..8], layout.little_endian)
        };
        let length = usize::try_from(length).map_err(|_| "A broken Blender file")?;
        let start = at + layout.head;
        if code == b"TEST" {
            return Ok(data.get(start..start.saturating_add(length)));
        }
        if code == b"ENDB" || code == b"DNA1" {
            return Ok(None);
        }
        at = start.checked_add(length).ok_or("A broken Blender file")?;
    }
    Ok(None)
}

/// The start of the file, unpacked if it's compressed.
fn unpacked_start(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    if bytes.starts_with(&[0x1f, 0x8b]) {
        // gzip: read what's there of the start (a cut-off stream still gives its start).
        let _ = flate2::read::GzDecoder::new(bytes)
            .take(LOOK_IN)
            .read_to_end(&mut out);
    } else if bytes.starts_with(&[0x28, 0xb5, 0x2f, 0xfd]) {
        // zstd, as one frame or several (Blender writes a frame per chunk, then a
        // skippable frame with where they start).
        let mut rest = bytes;
        while (out.len() as u64) < LOOK_IN && rest.len() >= 8 {
            let magic = u32::from_le_bytes([rest[0], rest[1], rest[2], rest[3]]);
            if magic & 0xFFFF_FFF0 == 0x184D_2A50 {
                let length = u32::from_le_bytes([rest[4], rest[5], rest[6], rest[7]]) as usize;
                rest = rest.get(8 + length..).unwrap_or_default();
                continue;
            }
            let Ok(mut frame) = ruzstd::decoding::StreamingDecoder::new(&mut rest) else {
                break;
            };
            let wanted = LOOK_IN - out.len() as u64;
            if (&mut frame).take(wanted).read_to_end(&mut out).is_err() {
                break;
            }
        }
    } else {
        out.extend_from_slice(&bytes[..bytes.len().min(LOOK_IN as usize)]);
    }
    Ok(out)
}

/// The preview picture of the `.blend` file in `bytes`.
pub fn preview(bytes: &[u8]) -> Result<RgbaImage, String> {
    let data = unpacked_start(bytes)?;
    if !data.starts_with(b"BLENDER") {
        return Err("Not a Blender file Tributary can read".into());
    }
    let little_endian = layout(&data).is_some_and(|layout| layout.little_endian);
    let block = preview_block(&data)?.ok_or("No preview was saved in this Blender file")?;
    if block.len() < 8 {
        return Err("A broken Blender preview".into());
    }
    let side = |at: usize| u32::try_from(number(&block[at..at + 4], little_endian)).unwrap_or(0);
    let (width, height) = (side(0), side(4));
    if width == 0 || height == 0 || width > BIGGEST || height > BIGGEST {
        return Err("A broken Blender preview".into());
    }
    let row = width as usize * 4;
    let pixels = block
        .get(8..8 + row * height as usize)
        .ok_or("A broken Blender preview")?;
    // Bottom row first: turned the right way up.
    let flipped: Vec<u8> = pixels.chunks_exact(row).rev().flatten().copied().collect();
    RgbaImage::from_raw(width, height, flipped).ok_or_else(|| "A broken Blender preview".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A tiny Blender file: its header, a render block, the 2 × 2 preview, then the end.
    pub(crate) fn blend_file(large: bool) -> Vec<u8> {
        let mut file = Vec::new();
        let block = |file: &mut Vec<u8>, code: &[u8; 4], data: &[u8]| {
            file.extend_from_slice(code);
            if large {
                file.extend_from_slice(&0u32.to_le_bytes()); // struct index
                file.extend_from_slice(&0u64.to_le_bytes()); // pointer
                file.extend_from_slice(&(data.len() as u64).to_le_bytes());
                file.extend_from_slice(&1u64.to_le_bytes()); // count
            } else {
                file.extend_from_slice(&(data.len() as u32).to_le_bytes());
                file.extend_from_slice(&0u64.to_le_bytes()); // pointer
                file.extend_from_slice(&0u32.to_le_bytes()); // struct index
                file.extend_from_slice(&1u32.to_le_bytes()); // count
            }
            file.extend_from_slice(data);
        };
        file.extend_from_slice(if large {
            b"BLENDER17-01v0500"
        } else {
            b"BLENDER-v405"
        });
        block(&mut file, b"REND", &[0; 72]);
        let mut preview = Vec::new();
        preview.extend_from_slice(&2u32.to_le_bytes());
        preview.extend_from_slice(&2u32.to_le_bytes());
        // Bottom row: red, green; top row: blue, white.
        preview.extend_from_slice(&[
            255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        ]);
        block(&mut file, b"TEST", &preview);
        block(&mut file, b"GLOB", &[0; 16]);
        block(&mut file, b"ENDB", &[]);
        file
    }

    fn check(image: &RgbaImage) {
        assert_eq!(image.dimensions(), (2, 2));
        assert_eq!(image.get_pixel(0, 0).0, [0, 0, 255, 255]);
        assert_eq!(image.get_pixel(1, 1).0, [0, 255, 0, 255]);
    }

    #[test]
    fn reads_the_preview_from_old_and_new_files() {
        check(&preview(&blend_file(false)).unwrap());
        check(&preview(&blend_file(true)).unwrap());
    }

    #[test]
    fn reads_compressed_files() {
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gzip.write_all(&blend_file(false)).unwrap();
        check(&preview(&gzip.finish().unwrap()).unwrap());
        // zstd: an uncompressed ("raw") block in one frame, then a skippable frame.
        let data = blend_file(true);
        let mut zstd = vec![0x28, 0xb5, 0x2f, 0xfd, 0x00];
        // Frame header descriptor 0: a window descriptor follows.
        zstd.push(0x58); // window: 1 MB
        let header = ((data.len() as u32) << 3) | 1; // last block, raw
        zstd.extend_from_slice(&header.to_le_bytes()[..3]);
        zstd.extend_from_slice(&data);
        zstd.extend_from_slice(&0x184D_2A5Eu32.to_le_bytes());
        zstd.extend_from_slice(&4u32.to_le_bytes());
        zstd.extend_from_slice(&[1, 2, 3, 4]);
        check(&preview(&zstd).unwrap());
    }

    #[test]
    fn says_when_there_is_no_preview() {
        let mut file = blend_file(false);
        let at = file.windows(4).position(|w| w == b"TEST").unwrap();
        file[at..at + 4].copy_from_slice(b"XXXX");
        assert_eq!(
            preview(&file).unwrap_err(),
            "No preview was saved in this Blender file"
        );
        assert!(preview(b"not a blend file").is_err());
    }
}
