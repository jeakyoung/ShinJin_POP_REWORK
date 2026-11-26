import { bands } from './production-report.ts';
import type { Report, ReportRow } from './production-report.ts';
import { productionStyles } from './production-xlsx-styles.ts';

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

// Small stored ZIP for the fixed ASCII entry names. No filesystem access.
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
  const coordinate = (column: number, row: number) => String.fromCharCode(65 + column) + row;
  function cell(column: number, row: number, value: string | number | null, style: number) {
    const attr = 'r="' + coordinate(column, row) + '" s="' + style + '"';
    if (value === null || value === '') return '<c ' + attr + '/>';
    if (typeof value === 'number') return '<c ' + attr + '><v>' + value + '</v></c>';
    return '<c ' + attr + ' t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>';
  }
  const widths = [5.14, 10.43, 5.14, 7, 8.43, 14, 4.86, 4.86, 17.29, 7.57, 4.29];
  const cols = widths.map((width, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width + '" customWidth="1"/>');
  const bandTitles = widths.map((_, column) => cell(column, 1, [1,5,6,9].includes(column) ? ' ' : null, 1));
  const rows = ['<row r="1" ht="12.75" customHeight="1">' + bandTitles.join('') + '</row>'];
  const merges = ['G1:H1'];
  function writeBand(first: number, row?: ReportRow) {
    const grid = [Array<string>(11), Array<string>(11)];
    for (const [tier, fields] of bands.entries()) {
      for (const field of fields) {
        const numeric = field.key === 'index' || field.key === 'run';
        const qty = field.key === 'ordered' || field.key === 'bad';
        const style = !row ? 2 : field.key === null ? 6 : field.key === 'good' ? 7 : numeric ? 3 : qty ? 5 : 4;
        const value = !row ? field.title : field.key ? row[field.key] : null;
        for (let dy = 0; dy < (field.rowSpan ?? 1); dy++) {
          for (let dx = 0; dx < (field.colSpan ?? 1); dx++) {
            grid[tier + dy][field.column + dx] = cell(field.column + dx, first + tier + dy, dx || dy ? null : value, style);
          }
        }
        if (field.rowSpan || field.colSpan) merges.push(coordinate(field.column, first + tier) + ':' +
          coordinate(field.column + (field.colSpan ?? 1) - 1, first + tier + (field.rowSpan ?? 1) - 1));
      }
    }
    grid.forEach((fields, tier) => rows.push('<row r="' + (first + tier) + '" ht="' + (row ? 28.5 : 32.25) +
      '" customHeight="1">' + fields.join('') + '</row>'));
  }
  writeBand(2);
  report.rows.forEach((row, i) => writeBand(4 + i * 2, row));
  const merged = merges.map(ref => '<mergeCell ref="' + ref + '"/>').join('');
  const rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
  return archive({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${relationship}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${main}" xmlns:r="${relationship}"><sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${relationship}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relationship}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': productionStyles,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews><cols>${cols.join('')}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merged}</mergeCells></worksheet>`,
  });
}
