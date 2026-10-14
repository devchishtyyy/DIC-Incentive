/**
 * CSV and XLSX writers. The XLSX side is a minimal, dependency-free Office Open XML
 * workbook packed into a stored (uncompressed) ZIP — enough for Excel to open it, with no
 * third-party library to keep patched.
 */

export type CellValue = string | number | null | undefined

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(value: CellValue): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: CellValue[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoke on the next tick so the download has definitely started.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(filename: string, rows: CellValue[][]): void {
  // The BOM makes Excel open UTF-8 correctly on a Windows machine.
  downloadBlob(filename, new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

const encoder = new TextEncoder()

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  bytes: Uint8Array
  crc: number
}

/** Stored-method ZIP. Excel accepts an uncompressed xlsx package. */
function zip(files: Array<{ name: string; content: string }>): Blob {
  const entries: ZipEntry[] = files.map((file) => {
    const bytes = encoder.encode(file.content)
    return { name: file.name, bytes, crc: crc32(bytes) }
  })

  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let offset = 0

  const u16 = (value: number) => new Uint8Array([value & 0xff, (value >>> 8) & 0xff])
  const u32 = (value: number) => new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
  const push = (...parts: Uint8Array[]) => {
    for (const part of parts) {
      chunks.push(part)
      offset += part.length
    }
  }

  for (const entry of entries) {
    offsets.push(offset)
    const name = encoder.encode(entry.name)
    push(
      u32(0x04034b50), // local file header
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method: stored
      u16(0), // mod time
      u16(0x2158), // mod date — a fixed 2016-10-24 so output is byte-stable
      u32(entry.crc),
      u32(entry.bytes.length),
      u32(entry.bytes.length),
      u16(name.length),
      u16(0),
      name,
      entry.bytes,
    )
  }

  const centralStart = offset
  entries.forEach((entry, index) => {
    const name = encoder.encode(entry.name)
    push(
      u32(0x02014b50), // central directory header
      u16(20), // version made by
      u16(20), // version needed
      u16(0),
      u16(0),
      u16(0),
      u16(0x2158),
      u32(entry.crc),
      u32(entry.bytes.length),
      u32(entry.bytes.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offsets[index]),
      name,
    )
  })

  push(
    u32(0x06054b50), // end of central directory
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(offset - centralStart),
    u32(centralStart),
    u16(0),
  )

  return new Blob(chunks as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Strip control characters Excel rejects.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

function columnName(index: number): string {
  let name = ''
  let n = index
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  }
  return name
}

/**
 * Writes a single-sheet workbook. The first row is styled bold via a minimal style part.
 */
export function buildXlsx(sheetName: string, rows: CellValue[][]): Blob {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          if (value === null || value === undefined || value === '') return ''
          const ref = `${columnName(colIndex)}${rowIndex + 1}`
          const style = rowIndex === 0 ? ' s="1"' : ''
          if (typeof value === 'number' && Number.isFinite(value)) {
            return `<c r="${ref}"${style}><v>${value}</v></c>`
          }
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')

  const widest = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const cols = Array.from({ length: widest }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="18" customWidth="1"/>`).join('')

  const files = [
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${xmlEscape(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/styles.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
        '<borders count="1"><border/></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '</styleSheet>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        (cols ? `<cols>${cols}</cols>` : '') +
        `<sheetData>${sheetRows}</sheetData>` +
        '</worksheet>',
    },
  ]

  return zip(files)
}

export function downloadXlsx(filename: string, sheetName: string, rows: CellValue[][]): void {
  downloadBlob(filename, buildXlsx(sheetName, rows))
}
