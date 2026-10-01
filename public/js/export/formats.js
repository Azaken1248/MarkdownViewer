/* The four things a snapshot can become.
 *
 * All of them start from the same self-contained HTML file, so they agree
 * with each other and with the screen. What differs is what each format can
 * carry:
 *
 *   HTML  everything, exactly — it is the snapshot.
 *   PDF   everything, through the browser's own print engine, so the text
 *         stays text and the maths stays sharp.
 *   DOCX  the snapshot handed to Word to convert on open, which keeps the
 *         colours, the tables and the pictures and re-flows the rest.
 *   MD    the source. Markdown has no way to say "there is a diagram here,
 *         and somebody has drawn a circle round it".
 */

/* exported ExportFormats */
var ExportFormats = (function () {
  "use strict";

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Given back once the browser has taken the data, not before.
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /* A document's name, as a file on somebody's disk.
   *
   * The folders in a library path become part of the name rather than being
   * dropped, so two documents called Notes in different folders do not both
   * land in Downloads as Notes.pdf. What is left after the characters a
   * filesystem refuses have gone may be nothing at all, and a file called
   * "-" helps nobody.
   */
  const fileStem = (name) => String(name || "document")
    .replace(/\.[^./\\]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[-\s]+|[-\s]+$/g, "") || "document";

  /* --- HTML and Markdown --------------------------------------------------- */

  function toHtml(snapshot, name) {
    download(new Blob([snapshot.html], { type: "text/html;charset=utf-8" }), `${fileStem(name)}.html`);
  }

  function toMarkdown(source, name) {
    download(new Blob([String(source ?? "")], { type: "text/markdown;charset=utf-8" }),
      `${fileStem(name)}.md`);
  }

  /* --- PDF ----------------------------------------------------------------
   *
   * Written here rather than printed.
   *
   * The browser can make a PDF, but only through the print dialogue, and the
   * dialogue is the person's and not the page's: it adds its own margins
   * around the ones the sheets already carry, scales the sheet down to fit
   * inside them, and leaves a white border round a document whose background
   * is not white. No CSS overrules a setting in a dialogue.
   *
   * So the sheets the paginator chose are drawn and assembled into a file
   * directly: the right size, the right number of pages, the background to
   * the edge of the paper, and a download rather than a dialogue.
   */
  async function toPdf(snapshot, name, onPage) {
    const bytes = await ExportPdf.render({
      sheets: snapshot.sheets,
      css: snapshot.styles,
      size: snapshot.size,
      paper: snapshot.paper,
      title: name,
      onPage
    });

    if (!bytes) {
      throw new Error("none of the pages could be drawn");
    }

    download(new Blob([bytes], { type: "application/pdf" }), `${fileStem(name)}.pdf`);
    return bytes.length;
  }

  /* --- DOCX ---------------------------------------------------------------
   *
   * A .docx is a zip of XML parts, and the smallest honest one that can hold
   * a rendered page is a document whose entire body is an "altChunk": a part
   * that says "here is some HTML, convert it when you open this". Word does
   * the conversion with its own importer, which keeps the headings, tables,
   * colours, backgrounds and pictures and re-flows the text to the page.
   *
   * Writing WordprocessingML directly would mean re-implementing that
   * importer — every element, every style, and OMML for the formulas — to
   * arrive at a worse version of the same thing.
   *
   * Entries are stored rather than deflated. A zip may do either, Word reads
   * both, and storing means no compressor: the file is bigger and the code
   * that makes it is a page long.
   */
  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="html" ContentType="text/html"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="htmlPart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="page.html"/>
</Relationships>`;

  const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:altChunk r:id="htmlPart"/>
    <w:sectPr/>
  </w:body>
</w:document>`;

  function toDocx(snapshot, name) {
    const zip = zipOf([
      ["[Content_Types].xml", CONTENT_TYPES],
      ["_rels/.rels", ROOT_RELS],
      ["word/document.xml", DOCUMENT_XML],
      ["word/_rels/document.xml.rels", DOC_RELS],
      ["word/page.html", snapshot.html]
    ]);

    download(new Blob([zip], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }), `${fileStem(name)}.docx`);
  }

  /* --- A zip, by hand ------------------------------------------------------ */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);

    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
      }

      table[i] = value >>> 0;
    }

    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
      crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // A little-endian writer, which is the only byte order a zip has.
  function writer(size) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    let at = 0;

    return {
      bytes,
      get at() {
        return at;
      },
      u16(value) {
        view.setUint16(at, value, true);
        at += 2;
      },
      u32(value) {
        view.setUint32(at, value >>> 0, true);
        at += 4;
      },
      raw(chunk) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
    };
  }

  // Bit 11 says the name is UTF-8; without it a reader is entitled to assume
  // the code page of whichever machine it is running on.
  const UTF8_NAMES = 0x0800;

  function zipOf(entries) {
    const encoder = new TextEncoder();
    const parts = entries.map(([name, text]) => {
      const nameBytes = encoder.encode(name);
      const body = encoder.encode(text);
      return { nameBytes, body, crc: crc32(body) };
    });

    const local = parts.reduce((sum, part) => sum + 30 + part.nameBytes.length + part.body.length, 0);
    const central = parts.reduce((sum, part) => sum + 46 + part.nameBytes.length, 0);
    const out = writer(local + central + 22);
    const offsets = [];

    for (const part of parts) {
      offsets.push(out.at);
      out.u32(0x04034B50);
      out.u16(20);
      out.u16(UTF8_NAMES);
      out.u16(0);
      out.u16(0);
      out.u16(0);
      out.u32(part.crc);
      out.u32(part.body.length);
      out.u32(part.body.length);
      out.u16(part.nameBytes.length);
      out.u16(0);
      out.raw(part.nameBytes);
      out.raw(part.body);
    }

    const directoryAt = out.at;
    parts.forEach((part, index) => {
      out.u32(0x02014B50);
      out.u16(20);
      out.u16(20);
      out.u16(UTF8_NAMES);
      out.u16(0);
      out.u16(0);
      out.u16(0);
      out.u32(part.crc);
      out.u32(part.body.length);
      out.u32(part.body.length);
      out.u16(part.nameBytes.length);
      out.u16(0);
      out.u16(0);
      out.u16(0);
      out.u16(0);
      out.u32(0);
      out.u32(offsets[index]);
      out.raw(part.nameBytes);
    });

    // Measured before the end record is written, since writing it moves the
    // very cursor being measured.
    const directorySize = out.at - directoryAt;

    out.u32(0x06054B50);
    out.u16(0);
    out.u16(0);
    out.u16(parts.length);
    out.u16(parts.length);
    out.u32(directorySize);
    out.u32(directoryAt);
    out.u16(0);

    return out.bytes;
  }

  return { download, fileStem, toHtml, toMarkdown, toPdf, toDocx, zipOf, crc32 };
})();
