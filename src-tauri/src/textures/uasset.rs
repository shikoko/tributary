//! The thumbnail Unreal Engine saves in an asset's package (`.uasset`, `.umap`): the picture
//! its content browser shows, kept as an ordinary PNG (or, in newer versions, JPEG) image
//! inside the package. It's found by its signature and only taken when it decodes to a
//! picture of a thumbnail's size, so other data that happens to look alike isn't.

use image::{ImageFormat, RgbaImage};

/// An Unreal package starts with this tag (0x9E2A83C1, little-endian).
const PACKAGE_TAG: [u8; 4] = [0xC1, 0x83, 0x2A, 0x9E];
const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
/// A JPEG's start, then the first segment's marker (APP0, APP1 or a quantization table).
const JPEG: [u8; 3] = [0xFF, 0xD8, 0xFF];
/// At most this many candidates are tried.
const MOST_TRIES: usize = 8;
/// Thumbnails are at most this big a side (Unreal's are 256 or 512).
const BIGGEST: u32 = 1024;

/// Whether `bytes` are an Unreal package.
pub fn is_package(bytes: &[u8]) -> bool {
    bytes.starts_with(&PACKAGE_TAG)
}

fn positions<'a>(bytes: &'a [u8], needle: &'a [u8]) -> impl Iterator<Item = usize> + 'a {
    bytes
        .windows(needle.len())
        .enumerate()
        .filter(move |(_, window)| *window == needle)
        .map(|(at, _)| at)
}

/// The package's thumbnail, or why there isn't one.
pub fn preview(bytes: &[u8]) -> Result<RgbaImage, String> {
    if !is_package(bytes) {
        return Err("Not an Unreal package".into());
    }
    let pngs = positions(bytes, &PNG).map(|at| (at, ImageFormat::Png));
    let jpegs = positions(bytes, &JPEG)
        .filter(|at| matches!(bytes.get(at + 3), Some(0xE0 | 0xE1 | 0xDB)))
        .map(|at| (at, ImageFormat::Jpeg));
    let mut candidates: Vec<(usize, ImageFormat)> = pngs.chain(jpegs).collect();
    candidates.sort_by_key(|(at, _)| *at);
    for (at, format) in candidates.into_iter().take(MOST_TRIES) {
        let Ok(image) = image::load_from_memory_with_format(&bytes[at..], format) else {
            continue;
        };
        let (width, height) = (image.width(), image.height());
        if (16..=BIGGEST).contains(&width) && (16..=BIGGEST).contains(&height) {
            return Ok(image.to_rgba8());
        }
    }
    Err("No thumbnail was saved in this asset".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;
    use image::codecs::png::PngEncoder;

    /// A package with some data, the thumbnail's size and its PNG, and more data after.
    pub(crate) fn package_with_thumbnail(side: u32, colour: [u8; 4]) -> Vec<u8> {
        let mut png = Vec::new();
        let pixels: Vec<u8> = (0..side * side).flat_map(|_| colour).collect();
        PngEncoder::new(&mut png)
            .write_image(&pixels, side, side, image::ExtendedColorType::Rgba8)
            .unwrap();
        let mut package = PACKAGE_TAG.to_vec();
        package.extend_from_slice(&[0xF8, 0xFF, 0xFF, 0xFF]);
        // Something that starts like a JPEG but isn't one.
        package.extend_from_slice(&[0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
        package.extend_from_slice(&side.to_le_bytes());
        package.extend_from_slice(&side.to_le_bytes());
        package.extend_from_slice(&(png.len() as u32).to_le_bytes());
        package.extend_from_slice(&png);
        package.extend_from_slice(&[0u8; 64]);
        package
    }

    #[test]
    fn finds_the_thumbnail_in_a_package() {
        let image = preview(&package_with_thumbnail(64, [200, 40, 30, 255])).unwrap();
        assert_eq!(image.dimensions(), (64, 64));
        assert_eq!(image.get_pixel(10, 10).0, [200, 40, 30, 255]);
    }

    #[test]
    fn says_when_there_is_none() {
        let mut package = PACKAGE_TAG.to_vec();
        package.extend_from_slice(&[0u8; 500]);
        assert_eq!(
            preview(&package).unwrap_err(),
            "No thumbnail was saved in this asset"
        );
        assert!(preview(b"not a package").is_err());
        // Too small to be a thumbnail.
        assert!(preview(&package_with_thumbnail(4, [0, 0, 0, 255])).is_err());
    }
}
