//! Pictures the window can't show by itself, like the textures game projects keep (Targa,
//! DDS, OpenEXR, TIFF, Radiance HDR and Photoshop files): read here and handed over as PNG,
//! made smaller when they're big.

use std::io::Cursor;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ImageEncoder, ImageFormat, ImageReader, Limits, RgbaImage};

mod psd;

/// The extensions read here.
pub const FORMATS: [&str; 8] = ["tga", "dds", "exr", "tif", "tiff", "hdr", "psd", "psb"];

/// The longest side of a preview: bigger pictures are made smaller (they'd be slow to hand
/// over, and the window shows them smaller anyway).
const LARGEST: u32 = 2048;
/// Pictures with more pixels than this (8192 × 8192) aren't read.
const MOST_PIXELS: u64 = 8192 * 8192;

/// A picture as PNG, and how big the original is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preview {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Whether files with this extension are read here.
pub fn reads(extension: &str) -> bool {
    FORMATS.contains(&extension.to_ascii_lowercase().as_str())
}

/// The picture in `bytes` (a file with this extension) as a PNG preview, or why it can't be
/// shown.
pub fn preview(extension: &str, bytes: &[u8]) -> Result<Preview, String> {
    let extension = extension.to_ascii_lowercase();
    let image = match extension.as_str() {
        "psd" | "psb" => psd::composite(bytes, MOST_PIXELS)?,
        _ => decode(&extension, bytes)?,
    };
    let (width, height) = image.dimensions();
    let image = if width.max(height) > LARGEST {
        let scale = f64::from(LARGEST) / f64::from(width.max(height));
        let smaller = |side: u32| ((f64::from(side) * scale).round() as u32).max(1);
        image::imageops::thumbnail(&image, smaller(width), smaller(height))
    } else {
        image
    };
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::Adaptive)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("Couldn't make a preview: {e}"))?;
    Ok(Preview { png, width, height })
}

fn decode(extension: &str, bytes: &[u8]) -> Result<RgbaImage, String> {
    let format = match extension {
        "tga" => ImageFormat::Tga,
        "dds" => ImageFormat::Dds,
        "exr" => ImageFormat::OpenExr,
        "tif" | "tiff" => ImageFormat::Tiff,
        "hdr" => ImageFormat::Hdr,
        _ => return Err(format!("Can't read .{extension} files")),
    };
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits());
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| unreadable(extension, &e))?;
    if u64::from(width) * u64::from(height) > MOST_PIXELS {
        return Err(format!("Too big to show here ({width} × {height})"));
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits());
    let image = reader.decode().map_err(|e| unreadable(extension, &e))?;
    Ok(to_display(image))
}

/// How big a picture can be read: 16384 pixels a side, and 1 GB to read it into.
fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(1 << 30);
    limits
}

/// What to say when a picture can't be read.
fn unreadable(extension: &str, error: &image::ImageError) -> String {
    match error {
        image::ImageError::Unsupported(_) if extension == "dds" => {
            "Can't show this kind of DDS (only DXT1, DXT3 and DXT5 ones)".to_owned()
        }
        image::ImageError::Unsupported(_) => "Can't show this kind of picture".to_owned(),
        image::ImageError::Limits(_) => "Too big to show here".to_owned(),
        _ => "Couldn't read the picture".to_owned(),
    }
}

/// 8-bit RGBA to show. Floating-point pictures (OpenEXR, HDR, 32-bit TIFF) hold linear
/// light, not screen colours: they're converted to sRGB, and what's brighter than white is
/// shown as white.
fn to_display(image: DynamicImage) -> RgbaImage {
    match image {
        DynamicImage::ImageRgb32F(_) | DynamicImage::ImageRgba32F(_) => {
            let linear = image.into_rgba32f();
            let (width, height) = linear.dimensions();
            let pixels = linear
                .pixels()
                .flat_map(|pixel| {
                    let [r, g, b, a] = pixel.0;
                    [to_srgb(r), to_srgb(g), to_srgb(b), to_byte(a)]
                })
                .collect();
            RgbaImage::from_raw(width, height, pixels).unwrap_or_default()
        }
        image => image.into_rgba8(),
    }
}

/// A linear light value as an sRGB byte.
pub(crate) fn to_srgb(linear: f32) -> u8 {
    let linear = if linear.is_finite() {
        linear.clamp(0.0, 1.0)
    } else {
        0.0
    };
    let encoded = if linear <= 0.003_130_8 {
        linear * 12.92
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    };
    to_byte(encoded)
}

/// 0–1 as 0–255.
pub(crate) fn to_byte(value: f32) -> u8 {
    if value.is_finite() {
        (value.clamp(0.0, 1.0) * 255.0).round() as u8
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_size(png: &[u8]) -> (u32, u32) {
        let image = image::load_from_memory_with_format(png, ImageFormat::Png).unwrap_or_default();
        (image.width(), image.height())
    }

    #[test]
    fn reads_targa_and_tiff() {
        let picture = RgbaImage::from_fn(3, 2, |x, y| {
            image::Rgba([x as u8 * 80, y as u8 * 120, 7, 255])
        });
        for format in [ImageFormat::Tga, ImageFormat::Tiff] {
            let mut bytes = Vec::new();
            DynamicImage::ImageRgba8(picture.clone())
                .write_to(&mut Cursor::new(&mut bytes), format)
                .unwrap_or_default();
            let extension = if format == ImageFormat::Tga {
                "TGA"
            } else {
                "tif"
            };
            let preview = preview(extension, &bytes).unwrap_or_else(|e| panic!("{e}"));
            assert_eq!((preview.width, preview.height), (3, 2));
            let back = image::load_from_memory(&preview.png)
                .unwrap_or_default()
                .into_rgba8();
            assert_eq!(back, picture);
        }
    }

    #[test]
    fn makes_big_pictures_smaller() {
        let picture = RgbaImage::from_pixel(4096, 1024, image::Rgba([10, 20, 30, 255]));
        let mut bytes = Vec::new();
        DynamicImage::ImageRgba8(picture)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Tga)
            .unwrap_or_default();
        let preview = preview("tga", &bytes).unwrap_or_else(|e| panic!("{e}"));
        assert_eq!((preview.width, preview.height), (4096, 1024));
        assert_eq!(png_size(&preview.png), (2048, 512));
    }

    #[test]
    fn shows_linear_light_as_srgb() {
        assert_eq!(to_srgb(0.0), 0);
        assert_eq!(to_srgb(1.0), 255);
        assert_eq!(to_srgb(4.0), 255);
        assert_eq!(to_srgb(f32::NAN), 0);
        // Middle grey (18% of the light) is about 118 on screen.
        assert_eq!(to_srgb(0.18), 118);
    }

    #[test]
    fn reads_radiance_hdr() {
        // Middle grey, and a pixel brighter than white. (HDR files share an exponent across
        // a pixel's colours, so each brightness gets its own pixel.)
        let picture = image::Rgb32FImage::from_fn(2, 1, |x, _| {
            image::Rgb(if x == 0 { [0.18; 3] } else { [8.0; 3] })
        });
        let mut bytes = Vec::new();
        DynamicImage::ImageRgb32F(picture)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Hdr)
            .unwrap_or_default();
        let preview = preview("hdr", &bytes).unwrap_or_else(|e| panic!("{e}"));
        let back = image::load_from_memory(&preview.png)
            .unwrap_or_default()
            .into_rgba8();
        let [grey, _, _, alpha] = back.get_pixel(0, 0).0;
        assert!((116..=119).contains(&grey), "{grey}");
        assert_eq!(alpha, 255);
        assert_eq!(back.get_pixel(1, 0).0, [255; 4]);
    }

    #[test]
    fn reads_openexr() {
        let picture = image::Rgba32FImage::from_fn(2, 1, |x, _| {
            image::Rgba(if x == 0 {
                [0.18, 0.18, 0.18, 0.5]
            } else {
                [8.0, 0.0, 1.0, 1.0]
            })
        });
        let mut bytes = Vec::new();
        DynamicImage::ImageRgba32F(picture)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::OpenExr)
            .unwrap_or_default();
        let preview = preview("exr", &bytes).unwrap_or_else(|e| panic!("{e}"));
        let back = image::load_from_memory(&preview.png)
            .unwrap_or_default()
            .into_rgba8();
        assert_eq!(back.get_pixel(0, 0).0, [118, 118, 118, 128]);
        assert_eq!(back.get_pixel(1, 0).0, [255, 0, 255, 255]);
    }

    #[test]
    fn says_why_it_cant_read_one() {
        assert_eq!(
            preview("tga", b"not a picture").err().as_deref(),
            Some("Couldn't read the picture")
        );
        assert!(reads("Hero.PSD".rsplit('.').next().unwrap_or_default()));
        assert!(!reads("png"));
    }
}
