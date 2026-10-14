/**
 * The XLSX writer is hand-rolled, so these tests take the workbook apart again: walk the
 * ZIP central directory, follow every offset, re-check every CRC, and read the sheet XML
 * back. A wrong offset or a stale length would show up here rather than in Excel.
 */

import { describe, expect, it } from 'vitest'
import { buildXlsx, toCsv } from './exporters'

// ---------------------------------------------------------------------------
// A minimal ZIP reader, written against the spec rather than against the writer.
// ---------------------------------------------------------------------------

function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

interface ReadEntry {
  name: string
  text: string
  crcMatches: boolean
}

function readZip(buffer: ArrayBuffer): ReadEntry[] {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const decoder = new TextDecoder()

  // End of central directory: scan back for the signature.
  let eocd = -1
  for (let i = buffer.byteLength - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  expect(eocd, 'end of central directory record').toBeGreaterThanOrEqual(0)

  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  const entries: ReadEntry[] = []

  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(cursor, true), `central directory header ${i}`).toBe(0x02014b50)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))

    // Follow the offset into the local file header and pull the data out.
    expect(view.getUint32(localOffset, true), `local header for ${name}`).toBe(0x04034b50)
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const data = bytes.subarray(dataStart, dataStart + compressedSize)

    entries.push({ name, text: decoder.decode(data), crcMatches: crc32(data) === crc })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

const SAMPLE = [
  ['Emp Code', 'Employee Name', 'Pay Grade', 'Days Scored', 'Production Score /20'],
  [1295, 'Ahmad Raza', 'Grade B', 26, 20],
  [6289, 'Bilal Khan', 'Grade C', 25, 14.73],
  [7092, 'Quote " and <angle> & amp', 'P1', 0, ''],
]

describe('the XLSX writer produces a readable workbook', async () => {
  const buffer = await buildXlsx('Production 2026-08', SAMPLE).arrayBuffer()
  const entries = readZip(buffer)
  const byName = new Map(entries.map((entry) => [entry.name, entry]))

  it('contains every part Excel requires', () => {
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
      expect(byName.has(part), part).toBe(true)
    }
  })

  it('stores a correct CRC and length for every part', () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.crcMatches, `CRC for ${entry.name}`).toBe(true)
      expect(entry.text.startsWith('<?xml'), `${entry.name} is well-formed XML`).toBe(true)
    }
  })

  it('names the sheet', () => {
    expect(byName.get('xl/workbook.xml')!.text).toContain('name="Production 2026-08"')
  })

  it('writes numbers as numbers and text as inline strings', () => {
    const sheet = byName.get('xl/worksheets/sheet1.xml')!.text
    expect(sheet).toContain('<c r="A2"><v>1295</v></c>') // Emp Code stays numeric
    expect(sheet).toContain('<v>14.73</v>') // the score keeps its 2 decimals
    expect(sheet).toContain('<t xml:space="preserve">Ahmad Raza</t>')
  })

  it('escapes the characters that would break the XML', () => {
    const sheet = byName.get('xl/worksheets/sheet1.xml')!.text
    expect(sheet).toContain('Quote &quot; and &lt;angle&gt; &amp; amp')
    expect(sheet).not.toContain('<angle>')
  })

  it('places every cell at the reference its row and column imply', () => {
    const sheet = byName.get('xl/worksheets/sheet1.xml')!.text
    expect(sheet).toContain('<row r="1">')
    expect(sheet).toContain('r="E1"') // five header columns, A to E
    expect(sheet).toContain('r="A4"')
    expect(sheet).not.toContain('r="F') // nothing past the last column
  })

  it('bolds the header row only', () => {
    const sheet = byName.get('xl/worksheets/sheet1.xml')!.text
    expect(sheet).toContain('<c r="A1" s="1"')
    expect(sheet).not.toContain('<c r="A2" s="1"')
  })

  it('leaves an empty cell out rather than writing an empty string', () => {
    const sheet = byName.get('xl/worksheets/sheet1.xml')!.text
    expect(sheet).not.toContain('r="E4"') // the blank score in the last row
  })
})

describe('the CSV writer', () => {
  it('quotes only the cells that need it', () => {
    expect(toCsv([['plain', 'with,comma', 'with"quote', 'with\nnewline', '']])).toBe(
      'plain,"with,comma","with""quote","with\nnewline",',
    )
  })

  it('writes blanks for null and undefined, not the words', () => {
    expect(toCsv([[null, undefined, 0]])).toBe(',,0')
  })

  it('separates rows with CRLF, as Excel on Windows expects', () => {
    expect(toCsv([['a'], ['b']])).toBe('a\r\nb')
  })
})
