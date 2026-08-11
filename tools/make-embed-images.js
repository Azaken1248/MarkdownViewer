// Draws the PNGs that link previews use.
//
// Why this exists at all: the app's only image was favicon.svg, and no embed
// crawler renders SVG. Discord, Slack, X and iOS's apple-touch-icon all want a
// raster image, so a link to the app came out with no picture on it. These are
// the raster copies.
//
// Why a generator rather than two committed binaries with no history: a PNG in
// a repo is a fact nobody can check or change. This way the design is the
// source — the same tile, page, fold and text lines as favicon.svg, in the same
// four colours — and regenerating after a palette change is one command.
//
//   node tools/make-embed-images.js
//
// No dependencies. zlib is Node's, and a PNG is a signature, three chunks and a
// CRC, all of which are cheaper to write than to justify a package for.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "public", "img");

// Straight from favicon.svg. Same tile, same accent, same darker fold.
const GROUND = [0x0c, 0x12, 0x14];
const BORDER = [0x2e, 0x3d, 0x42];
const ACCENT = [0x8e, 0xd9, 0xcf];
const FOLD = [0x3f, 0x8d, 0x84];

// Edges are found by testing several points per pixel and averaging, which is
// what keeps the rounded corners and the diagonal fold from going to staircases
// at these sizes.
const SAMPLES = 4;

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

// 8-bit RGB, no alpha: these are opaque cards, and a crawler that mishandles
// transparency has one less thing to get wrong.
function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    // Filter 0 (None). The image is flat colour and a few edges; the clever
    // filters would save little and cost a great deal of explaining.
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // adaptive filtering
  ihdr[12] = 0;   // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// --- shapes ---------------------------------------------------------------

const inRoundedRect = (x, y, rect) => {
  const { left, top, width, height, radius } = rect;
  const right = left + width;
  const bottom = top + height;

  if (x < left || x > right || y < top || y > bottom) {
    return false;
  }

  // Only the four corner boxes need the distance check.
  const cx = x < left + radius ? left + radius : (x > right - radius ? right - radius : x);
  const cy = y < top + radius ? top + radius : (y > bottom - radius ? bottom - radius : y);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
};

// The page: a rounded rectangle with its top-right corner taken off, which is
// what the fold is folded from.
const inPage = (x, y, page) => {
  if (!inRoundedRect(x, y, page)) {
    return false;
  }

  const cut = page.cut;
  const right = page.left + page.width;
  return (right - x) + (y - page.top) >= cut;
};

const inFold = (x, y, page) => {
  const cut = page.cut;
  const right = page.left + page.width;
  return x <= right
    && y >= page.top
    && (right - x) + (y - page.top) <= cut
    && (right - x) >= 0
    && (y - page.top) >= 0;
};

// One mark, drawn at whatever size and position it is given, so the card and
// the icon are the same picture rather than two drawings that resemble it.
function markColorAt(x, y, mark) {
  const { left, top, size } = mark;
  const u = (x - left) / size;
  const v = (y - top) / size;

  if (u < 0 || u > 1 || v < 0 || v > 1) {
    return null;
  }

  // The favicon's geometry, in units of its 32-unit viewBox.
  const s = (n) => n / 32;
  const page = {
    left: s(8.6), top: s(5.6), width: s(14.8), height: s(20.8),
    radius: s(2.4), cut: s(5.1)
  };
  const lines = [
    { left: s(11.7), top: s(13.6), width: s(8.8), height: s(2.3), radius: s(1.15) },
    { left: s(11.7), top: s(19.2), width: s(5.9), height: s(2.3), radius: s(1.15) }
  ];

  for (const line of lines) {
    if (inRoundedRect(u, v, line)) {
      return GROUND;
    }
  }

  if (inFold(u, v, page)) {
    return FOLD;
  }

  if (inPage(u, v, page)) {
    return ACCENT;
  }

  return null;
}

function draw(width, height, paint) {
  const rgb = Buffer.alloc(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const [pr, pg, pb] = paint(
            x + (sx + 0.5) / SAMPLES,
            y + (sy + 0.5) / SAMPLES
          );
          r += pr;
          g += pg;
          b += pb;
        }
      }

      const n = SAMPLES * SAMPLES;
      const at = (y * width + x) * 3;
      rgb[at] = Math.round(r / n);
      rgb[at + 1] = Math.round(g / n);
      rgb[at + 2] = Math.round(b / n);
    }
  }

  return encodePng(width, height, rgb);
}

// --- the two images -------------------------------------------------------

// 1200x630 is the size every crawler documents, and the one Discord gives a
// full-width card to rather than a thumbnail.
function embedCard() {
  const width = 1200;
  const height = 630;
  const size = 380;
  const mark = { left: (width - size) / 2, top: (height - size) / 2, size };

  // A hairline inset border, the same one the tile has, so the card reads as a
  // surface from this app rather than as a floating logo.
  const frame = { left: 24, top: 24, width: width - 48, height: height - 48, radius: 28 };
  const inner = { left: 26, top: 26, width: width - 52, height: height - 52, radius: 26 };

  return draw(width, height, (x, y) => {
    const painted = markColorAt(x, y, mark);
    if (painted) {
      return painted;
    }

    if (inRoundedRect(x, y, frame) && !inRoundedRect(x, y, inner)) {
      return BORDER;
    }

    return GROUND;
  });
}

// Square, for apple-touch-icon and for anything that wants a small square
// rather than a wide card.
function icon(size) {
  const tile = { left: 0, top: 0, width: size, height: size, radius: size * 7 / 32 };
  const inset = size * 0.5 / 32;
  const innerTile = {
    left: inset, top: inset,
    width: size - inset * 2, height: size - inset * 2,
    radius: size * 6.5 / 32
  };
  const mark = { left: 0, top: 0, size };

  return draw(size, size, (x, y) => {
    const painted = markColorAt(x, y, mark);
    if (painted) {
      return painted;
    }

    if (inRoundedRect(x, y, tile) && !inRoundedRect(x, y, innerTile)) {
      return BORDER;
    }

    // Outside the tile's rounded corners there is nothing to draw, and this is
    // an opaque format, so the ground carries on.
    return GROUND;
  });
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const written = [
  ["embed-card.png", embedCard()],
  ["icon-512.png", icon(512)],
  ["icon-180.png", icon(180)]
];

for (const [name, bytes] of written) {
  fs.writeFileSync(path.join(OUT_DIR, name), bytes);
  console.log(`${name}  ${bytes.length} bytes`);
}
