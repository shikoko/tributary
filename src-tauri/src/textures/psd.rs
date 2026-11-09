//! The flattened picture a Photoshop file (.psd, or .psb for big ones) keeps after its
//! layers: what Photoshop shows, saved for other programs to read.

use image::RgbaImage;

use super::{to_byte, to_srgb};

/// Reads big-endian numbers, never past the end.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

const TRUNCATED: &str = "The Photoshop file is cut short";

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self.at.checked_add(count).ok_or(TRUNCATED)?;
        let slice = self.bytes.get(self.at..end).ok_or(TRUNCATED)?;
        self.at = end;
        Ok(slice)
    }
    fn u16(&mut self) -> Result<u16, String> {
        let bytes = self.take(2)?;
        Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
    }
    fn u32(&mut self) -> Result<u32, String> {
        let bytes = self.take(4)?;
        Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }
    fn u64(&mut self) -> Result<u64, String> {
        let bytes = self.take(8)?;
        let mut array = [0; 8];
        array.copy_from_slice(bytes);
        Ok(u64::from_be_bytes(array))
    }
    /// A section's length, 8 bytes in a .psb.
    fn length(&mut self, big: bool) -> Result<usize, String> {
        let length = if big {
            self.u64()?
        } else {
            u64::from(self.u32()?)
        };
        usize::try_from(length).map_err(|_| TRUNCATED.to_owned())
    }
}

/// Colour modes, as Photoshop numbers them.
const BITMAP: u16 = 0;
const GRAYSCALE: u16 = 1;
const RGB: u16 = 3;
const CMYK: u16 = 4;
const DUOTONE: u16 = 8;

/// The flattened picture in a Photoshop file, if it isn't bigger than `most_pixels`.
pub(super) fn composite(bytes: &[u8], most_pixels: u64) -> Result<RgbaImage, String> {
    let mut reader = Reader { bytes, at: 0 };
    if reader.take(4)? != b"8BPS" {
        return Err("Not a Photoshop file".to_owned());
    }
    let big = match reader.u16()? {
        1 => false,
        2 => true,
        _ => return Err("Can't read this version of Photoshop file".to_owned()),
    };
    reader.take(6)?;
    let channels = usize::from(reader.u16()?);
    let height = reader.u32()?;
    let width = reader.u32()?;
    let depth = reader.u16()?;
    let mode = reader.u16()?;
    if width == 0 || height == 0 || channels == 0 {
        return Err("The Photoshop file has no picture".to_owned());
    }
    if u64::from(width) * u64::from(height) > most_pixels {
        return Err(format!("Too big to show here ({width} × {height})"));
    }
    // What the colours are made of, and how many channels that takes.
    let colours = match mode {
        BITMAP if depth == 1 => 1,
        GRAYSCALE | DUOTONE => 1,
        RGB => 3,
        CMYK => 4,
        _ => {
            return Err(
                "Can't show this Photoshop colour mode (only RGB, CMYK and grayscale)".to_owned(),
            );
        }
    };
    if channels < colours || !matches!(depth, 1 | 8 | 16 | 32) {
        return Err("Can't read this Photoshop file".to_owned());
    }
    // Colour mode data and image resources: not needed.
    let skip = reader.length(false)?;
    reader.take(skip)?;
    let skip = reader.length(false)?;
    reader.take(skip)?;
    // Layers: only whether the flattened picture has transparency, which is when the layer
    // count is negative (its first extra channel is then the transparency).
    let layers_length = reader.length(big)?;
    let layers = reader.take(layers_length)?;
    let transparent = {
        let mut layers = Reader {
            bytes: layers,
            at: 0,
        };
        match layers.length(big) {
            Ok(info) if info >= 2 => layers.u16().is_ok_and(|count| (count as i16) < 0),
            _ => false,
        }
    };
    let used = if transparent && channels > colours {
        colours + 1
    } else {
        colours
    };

    let (w, h) = (width as usize, height as usize);
    let row_bytes = (w * usize::from(depth)).div_ceil(8);
    let compression = reader.u16()?;
    // Each channel's rows, one after another, as bytes.
    let mut planes: Vec<Vec<u8>> = Vec::with_capacity(used);
    match compression {
        0 => {
            for _ in 0..used {
                planes.push(reader.take(row_bytes * h)?.to_vec());
            }
        }
        1 => {
            // Run-length encoded (PackBits): first how many bytes each row takes, for every
            // channel, then the rows.
            let mut lengths = Vec::with_capacity(channels * h);
            for _ in 0..channels * h {
                lengths.push(if big {
                    reader.u32()? as usize
                } else {
                    usize::from(reader.u16()?)
                });
            }
            for channel in 0..used {
                let mut plane = Vec::with_capacity(row_bytes * h);
                for row in 0..h {
                    let packed = reader.take(lengths[channel * h + row])?;
                    unpack_bits(packed, row_bytes, &mut plane)?;
                }
                planes.push(plane);
            }
        }
        _ => return Err("Can't read this Photoshop file's compression".to_owned()),
    }

    // A channel's value at a pixel, 0–255.
    let value = |plane: &[u8], index: usize| -> u8 {
        match depth {
            1 => {
                let row = index / w;
                let column = index % w;
                let byte = plane[row * row_bytes + column / 8];
                // In bitmap mode a set bit is black.
                if byte & (0x80 >> (column % 8)) == 0 {
                    255
                } else {
                    0
                }
            }
            8 => plane[index],
            16 => plane[index * 2],
            _ => {
                let at = index * 4;
                let bits =
                    u32::from_be_bytes([plane[at], plane[at + 1], plane[at + 2], plane[at + 3]]);
                // 32-bit documents hold linear light.
                to_srgb(f32::from_bits(bits))
            }
        }
    };
    let alpha = |index: usize| -> u8 {
        match planes.get(colours) {
            Some(plane) if depth == 32 => {
                let at = index * 4;
                let bits =
                    u32::from_be_bytes([plane[at], plane[at + 1], plane[at + 2], plane[at + 3]]);
                to_byte(f32::from_bits(bits))
            }
            Some(plane) => value(plane, index),
            None => 255,
        }
    };
    let mut pixels = Vec::with_capacity(w * h * 4);
    for index in 0..w * h {
        let [r, g, b] = match colours {
            1 => {
                let grey = value(&planes[0], index);
                [grey, grey, grey]
            }
            3 => [
                value(&planes[0], index),
                value(&planes[1], index),
                value(&planes[2], index),
            ],
            _ => {
                // Photoshop keeps CMYK inverted (255 is no ink): multiply each by black.
                let k = u16::from(value(&planes[3], index));
                let ink = |plane: &[u8]| (u16::from(value(plane, index)) * k / 255) as u8;
                [ink(&planes[0]), ink(&planes[1]), ink(&planes[2])]
            }
        };
        pixels.extend_from_slice(&[r, g, b, alpha(index)]);
    }
    RgbaImage::from_raw(width, height, pixels).ok_or_else(|| "Couldn't read the picture".to_owned())
}

/// Unpacks one PackBits row of `length` bytes onto `out`.
fn unpack_bits(mut packed: &[u8], length: usize, out: &mut Vec<u8>) -> Result<(), String> {
    let end = out.len() + length;
    while out.len() < end {
        let (&header, rest) = packed.split_first().ok_or(TRUNCATED)?;
        packed = rest;
        let header = header as i8;
        if header >= 0 {
            // The next 1–128 bytes as they are.
            let count = header as usize + 1;
            let (literal, rest) = packed.split_at_checked(count).ok_or(TRUNCATED)?;
            out.extend_from_slice(literal);
            packed = rest;
        } else if header != -128 {
            // The next byte 2–128 times.
            let (&byte, rest) = packed.split_first().ok_or(TRUNCATED)?;
            out.extend(std::iter::repeat_n(
                byte,
                (1 - isize::from(header)) as usize,
            ));
            packed = rest;
        }
    }
    // A row that unpacks too long is damaged: keep the picture's shape.
    out.truncate(end);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A Photoshop file: `planes` hold each channel's rows (8-bit), RLE-compressed or not.
    fn psd(
        width: u32,
        height: u32,
        mode: u16,
        planes: &[Vec<u8>],
        transparent: bool,
        rle: bool,
    ) -> Vec<u8> {
        let mut out = b"8BPS".to_vec();
        out.extend(1u16.to_be_bytes());
        out.extend([0; 6]);
        out.extend((planes.len() as u16).to_be_bytes());
        out.extend(height.to_be_bytes());
        out.extend(width.to_be_bytes());
        out.extend(8u16.to_be_bytes());
        out.extend(mode.to_be_bytes());
        out.extend(0u32.to_be_bytes()); // colour mode data
        out.extend(0u32.to_be_bytes()); // image resources
        if transparent {
            out.extend(6u32.to_be_bytes());
            out.extend(2u32.to_be_bytes());
            out.extend((-1i16).to_be_bytes());
        } else {
            out.extend(0u32.to_be_bytes());
        }
        if rle {
            out.extend(1u16.to_be_bytes());
            let mut rows = Vec::new();
            for plane in planes {
                for row in plane.chunks(width as usize) {
                    // Every row as one literal run.
                    let mut packed = vec![(row.len() - 1) as u8];
                    packed.extend_from_slice(row);
                    rows.push(packed);
                }
            }
            for row in &rows {
                out.extend((row.len() as u16).to_be_bytes());
            }
            for row in rows {
                out.extend(row);
            }
        } else {
            out.extend(0u16.to_be_bytes());
            for plane in planes {
                out.extend(plane);
            }
        }
        out
    }

    #[test]
    fn reads_rgb_with_and_without_transparency() {
        let planes = vec![vec![255, 0], vec![0, 255], vec![10, 20], vec![128, 64]];
        for rle in [false, true] {
            let opaque = composite(&psd(2, 1, RGB, &planes, false, rle), 100).unwrap_or_default();
            assert_eq!(
                opaque.as_raw(),
                &vec![255, 0, 10, 255, 0, 255, 20, 255],
                "rle {rle}"
            );
            let clear = composite(&psd(2, 1, RGB, &planes, true, rle), 100).unwrap_or_default();
            assert_eq!(
                clear.as_raw(),
                &vec![255, 0, 10, 128, 0, 255, 20, 64],
                "rle {rle}"
            );
        }
    }

    #[test]
    fn reads_grayscale_and_cmyk() {
        let grey = composite(&psd(1, 2, GRAYSCALE, &[vec![30, 200]], false, true), 100)
            .unwrap_or_default();
        assert_eq!(grey.as_raw(), &vec![30, 30, 30, 255, 200, 200, 200, 255]);
        // No ink at all is white; full black ink is black.
        let planes = vec![vec![255, 255], vec![255, 255], vec![255, 255], vec![255, 0]];
        let cmyk = composite(&psd(2, 1, CMYK, &planes, false, false), 100).unwrap_or_default();
        assert_eq!(cmyk.as_raw(), &vec![255, 255, 255, 255, 0, 0, 0, 255]);
    }

    #[test]
    fn unpacks_runs() {
        let mut out = Vec::new();
        // Three 7s, then 1 and 2 as they are, then a no-op.
        unpack_bits(&[(-2i8) as u8, 7, 1, 1, 2, 0x80], 5, &mut out).unwrap_or_default();
        assert_eq!(out, vec![7, 7, 7, 1, 2]);
    }

    #[test]
    fn refuses_what_it_cant_read() {
        assert!(composite(b"8BPS", 100).is_err());
        assert!(composite(b"GIF89a", 100).is_err());
        let file = psd(
            20,
            20,
            RGB,
            &[vec![0; 400], vec![0; 400], vec![0; 400]],
            false,
            false,
        );
        assert_eq!(
            composite(&file, 100).err().as_deref(),
            Some("Too big to show here (20 × 20)")
        );
        // Cut short anywhere, it says so instead of reading past the end.
        for end in 0..file.len() - 1 {
            assert!(composite(&file[..end], 1000).is_err());
        }
    }
}
