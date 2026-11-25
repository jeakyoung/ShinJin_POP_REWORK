import { cells, headers, totals } from './production-report.ts';
import type { Report } from './production-report.ts';

const encoder = new TextEncoder();
const xml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

// Small stored ZIP for the five fixed ASCII entry names. No filesystem access.
function archive(entries: Readonly<Record<string, string>>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let directorySize = 0;
  for (const [path, content] of Object.entries(entries)) {
    const name = encoder.encode(path);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const record = new Uint8Array(30 + name.length);
    const header = new DataView(record.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(12, 33, true); // 1980-01-01
    header.setUint32(14, checksum, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    record.set(name, 30);
    local.push(record, data);

    const index = new Uint8Array(46 + name.length);
    const directory = new DataView(index.buffer);
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint16(14, 33, true);
    directory.setUint32(16, checksum, true);
    directory.setUint32(20, data.length, true);
    directory.setUint32(24, data.length, true);
    directory.setUint16(28, name.length, true);
    directory.setUint32(42, offset, true);
    index.set(name, 46);
    central.push(index);
    offset += record.length + data.length;
    directorySize += index.length;
  }
  const end = new Uint8Array(22);
  const footer = new DataView(end.buffer);
  footer.setUint32(0, 0x06054b50, true);
  footer.setUint16(8, central.length, true);
  footer.setUint16(10, central.length, true);
  footer.setUint32(12, directorySize, true);
  footer.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const bytes of [...local, ...central, end]) {
    result.set(bytes, cursor);
    cursor += bytes.length;
  }
  return result;
}

export function exportProductionXlsx(report: Report): Uint8Array | undefined {
  if (!report.rows.length) return;
  const summary = ['합계', '', '', '', '', '', '', '', ...totals(report.rows), '', '', '', ''];
  const rows = [headers, ...report.rows.map(cells), summary].map((values, index) => {
    const number = index + 1;
    const fields = values.map((value, column) => {
      const ref = String.fromCharCode(65 + column) + number;
      return typeof value === 'number' ? `<c r="${ref}"><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    });
    return `<row r="${number}">${fields.join('')}</row>`;
  });
  const rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
  return archive({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${relationship}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${main}" xmlns:r="${relationship}"><sheets><sheet name="최종생산" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${relationship}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews><sheetData>${rows.join('')}</sheetData></worksheet>`,
  });
}
