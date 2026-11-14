// Reads a PNG, as WebDriver's screenshots are (8 bits a channel, RGB or RGBA, not
// interlaced), without another dependency: enough to look at the pixels of the app's window.
import { inflateSync } from "node:zlib";

/** `buffer`'s pixels: its size, and the colour at (x, y) as [red, green, blue]. */
export function decodePng(buffer) {
  let width = 0;
  let height = 0;
  let header = null;
  const data = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      header = { depth: chunk[8], colour: chunk[9], interlace: chunk[12] };
    } else if (type === "IDAT") data.push(chunk);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header || header.depth !== 8 || header.interlace !== 0 || (header.colour !== 2 && header.colour !== 6)) {
    throw new Error(`Not a PNG this reads: ${JSON.stringify(header)}`);
  }
  const channels = header.colour === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = above ? above[x] : 0;
      const upLeft = above && x >= channels ? above[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const guess = left + up - upLeft;
        const [toLeft, toUp, toUpLeft] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - upLeft)];
        value += toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
      }
      row[x] = value & 255;
    }
  }
  return {
    width,
    height,
    at(x, y) {
      const index = y * stride + x * channels;
      return [pixels[index], pixels[index + 1], pixels[index + 2]];
    },
  };
}
