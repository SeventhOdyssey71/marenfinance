/**
 * A deterministic grain tile, encoded as a PNG data URI.
 *
 * WHY THIS EXISTS RATHER THAN AN SVG FILTER
 *
 * The document cover draws its grain with an inline SVG feTurbulence filter, which is
 * fine: a cover is one page. The deck is fifteen. Chrome cannot express an SVG filter in
 * PDF, so it rasterises the element the filter touches, and because the grain covers the
 * whole slide that means a full-frame bitmap per slide. Measured: the 15-slide deck came
 * out as 240 image objects of 1366x768 and weighed 15 MB, against 856 kB with the grain
 * switched off. The texture was costing 94% of the file.
 *
 * A pre-rasterised tile costs one small image object for the entire document, because
 * every slide references the same one. Same look, ~20 kB.
 *
 * The noise is generated from a fixed seed, so a rebuild of unchanged sources produces a
 * byte-identical file. That property is load-bearing elsewhere in this pipeline (the PDF
 * metadata dates are pinned for the same reason) and it would be a shame to lose it to
 * decoration.
 */

import zlib from 'node:zlib';

/* CRC-32, as PNG requires it for every chunk. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** mulberry32: small, fast, and identical on every machine and Node version. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An 8-bit greyscale PNG of uniform noise, `size` square.
 *
 * @returns {string} a `data:image/png;base64,…` URI, ready for `background-image`.
 */
export function grainTile({ size = 128, seed = 0x9e3779b9 } = {}) {
  const random = rng(seed);

  // One filter byte (0 = None) per scanline, then one byte per pixel.
  const raw = Buffer.alloc((size + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y += 1) {
    raw[p] = 0;
    p += 1;
    for (let x = 0; x < size; x += 1) {
      raw[p] = (random() * 256) | 0;
      p += 1;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  return `data:image/png;base64,${png.toString('base64')}`;
}
