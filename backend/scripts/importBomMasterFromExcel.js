import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(backendRoot, '.env') });

const workbookPath = process.argv[2] || 'C:/Users/sbvid/Documents/MBA PORTFOLIO/PROJECTS/EV_Motor_BOMs_BLDC_PMSM.xlsx';
const sqlOutputPath = path.join(backendRoot, 'sql', 'seed_bom_master.sql');
const csvOutputPath = path.join(projectRoot, 'bom_master.csv');

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseZipEntries(buffer) {
  const entries = new Map();
  let offset = buffer.length - 22;
  while (offset >= 0 && buffer.readUInt32LE(offset) !== 0x06054b50) offset -= 1;
  if (offset < 0) throw new Error('Invalid .xlsx file.');
  const totalEntries = buffer.readUInt16LE(offset + 10);
  let centralOffset = buffer.readUInt32LE(offset + 16);
  for (let index = 0; index < totalEntries; index += 1) {
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const compression = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer.slice(centralOffset + 46, centralOffset + 46 + nameLength).toString();
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    const data = compression === 8 ? zlib.inflateRawSync(compressed) : compressed;
    entries.set(name, data.toString('utf8'));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function columnIndex(cellRef) {
  return String(cellRef || '')
    .replace(/[0-9]/g, '')
    .split('')
    .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseWorkbook(filePath) {
  const entries = parseZipEntries(fs.readFileSync(filePath));
  const workbookXml = entries.get('xl/workbook.xml');
  const relsXml = entries.get('xl/_rels/workbook.xml.rels');
  const relMap = Object.fromEntries(
    Array.from(relsXml.matchAll(/<Relationship\b(?=[^>]*Id="([^"]+)")(?=[^>]*Target="([^"]+)")[^>]*>/g))
      .map((match) => [match[1], match[2]]),
  );
  const sharedXml = entries.get('xl/sharedStrings.xml') || '';
  const sharedStrings = Array.from(sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)).map(([si]) => decodeXml(
    Array.from(si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((match) => match[1]).join(''),
  ));
  const sheets = Array.from(workbookXml.matchAll(/<sheet\b(?=[^>]*name="([^"]+)")(?=[^>]*r:id="([^"]+)")[^>]*>/g))
    .map((match) => ({ name: match[1], relationshipId: match[2] }));

  return sheets.flatMap((sheet) => {
    const target = relMap[sheet.relationshipId].replace(/^\//, '');
    const sheetXml = entries.get(target.startsWith('xl/') ? target : `xl/${target}`);
    const rows = Array.from(sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)).map(([, rowXml]) => {
      const values = [];
      Array.from(rowXml.matchAll(/<c[^>]*r="([^"]+)"[^>]*?(?:t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g)).forEach((match) => {
        const [, ref, type, cellXml] = match;
        const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        const inlineMatch = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        const rawValue = valueMatch?.[1] ?? inlineMatch?.[1] ?? '';
        values[columnIndex(ref)] = type === 's' ? sharedStrings[Number(rawValue)] || '' : decodeXml(rawValue);
      });
      return values;
    });
    return rows.slice(1)
      .filter((row) => row.some((value) => String(value || '').trim() !== ''))
      .map((row) => ({
        sheet: sheet.name,
        componentName: String(row[0] || '').trim(),
        componentCategory: String(row[1] || '').trim(),
        specification: String(row[2] || '').trim(),
        quantityText: String(row[3] || '').trim(),
      }));
  });
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
}

function extractQuantity(quantityText) {
  const match = String(quantityText || '').match(/[-+]?\d*\.?\d+/);
  const quantity = match ? Number(match[0]) : 0;
  const uomText = String(quantityText || '').replace(/[-+]?\d*\.?\d+/g, '').trim().toLowerCase();
  const uom = uomText.startsWith('no') ? 'No'
    : uomText === 'nos' ? 'No'
      : uomText === 'kg' ? 'kg'
        : uomText === 'g' ? 'g'
          : uomText === 'ml' ? 'ml'
            : uomText === 'm' ? 'm'
              : uomText === 'sheet' ? 'Sheet'
                : uomText === 'set' ? 'Set'
                  : uomText || 'No';
  return { quantity, uom };
}

function parentForSheet(sheetName, items) {
  const normalized = normalize(sheetName);
  if (normalized.includes('bldc')) return items.find((item) => item.item_code === 'FG001');
  if (normalized.includes('3kw')) return items.find((item) => item.item_code === 'FG002');
  if (normalized.includes('7.5kw')) return items.find((item) => item.item_code === 'FG003');
  return null;
}

function stageFor(componentName, category) {
  const name = normalize(componentName);
  if (name.includes('stator') || name.includes('slot') || name.includes('varnish') || name.includes('copper')) return 'Stator Assembly';
  if (name.includes('rotor') || name.includes('magnet') || name.includes('shaft') || name.includes('bearing')) return 'Rotor Assembly';
  if (category === 'Packaging Materials' || category === 'Identification & Documentation') return 'Packing';
  if (name.includes('sensor') || name.includes('resolver') || name.includes('inspection')) return 'Testing';
  return 'Final Motor Assembly';
}

function scrapFactor(category) {
  if (category === 'Electrical Components') return 2.00;
  if (category === 'Insulation Materials') return 1.50;
  if (category === 'Consumables') return 3.00;
  if (category === 'Packaging Materials') return 1.00;
  return 0.50;
}

function aliases(componentName) {
  const name = normalize(componentName);
  if (name.includes('aluminium housing')) return ['housing'];
  if (name.includes('ndfeb permanent magnet')) return ['ndfeb magnet'];
  if (name.includes('deep groove bearing')) return ['bearing'];
  if (name.includes('enameled copper wire')) return ['copper wire'];
  return [name];
}

function variantTokens(text) {
  return Array.from(new Set(String(text || '').match(/n42|n45|n48|en8|en19|en24|6202|6205|6307|ip67|ip68|pg9|pg11|pg16|m5|m6|m8|0\.25|0\.30|0\.35|0\.5|0\.6|0\.8|1\.00|1\.20|1\.60|2\.5|4|6|8|10|12|150|200|250|1\.5|3|7\.5/gi) || []));
}

function findComponent(row, parent, items) {
  const rowAliases = aliases(row.componentName);
  const tokens = variantTokens(`${row.specification} ${row.quantityText} ${parent.item_name}`);
  const categoryMatches = items.filter((item) => item.category === row.componentCategory);
  const pool = categoryMatches.length ? categoryMatches : items;
  const scored = pool.map((item) => {
    const itemName = normalize(item.item_name);
    let score = 0;
    if (rowAliases.some((alias) => itemName.includes(alias))) score += 30;
    if (rowAliases.some((alias) => alias.split(' ').every((part) => itemName.includes(part)))) score += 15;
    tokens.forEach((token) => {
      if (itemName.includes(String(token).toLowerCase())) score += 12;
    });
    if (itemName === normalize(row.componentName)) score += 25;
    return { item, score };
  }).sort((first, second) => second.score - first.score);
  if (!scored[0] || scored[0].score <= 0) {
    throw new Error(`Unable to map BOM component "${row.componentName}" from ${row.sheet} to item_master.`);
  }
  return scored[0].item;
}

async function main() {
  const rowsFromWorkbook = parseWorkbook(workbookPath);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  });

  const [items] = await connection.query('SELECT item_id, item_code, item_name, category, uom FROM item_master WHERE status = "Active" ORDER BY item_id');
  await connection.end();

  const rows = rowsFromWorkbook.map((row, index) => {
    const parent = parentForSheet(row.sheet, items);
    if (!parent) throw new Error(`Unable to map BOM sheet "${row.sheet}" to a finished good.`);
    const component = findComponent(row, parent, items);
    const quantity = extractQuantity(row.quantityText);
    return {
      bom_id: index + 1,
      bom_code: `BOM-${parent.item_code}-${String(index + 1).padStart(3, '0')}`,
      parent_item_id: parent.item_id,
      component_item_id: component.item_id,
      component_name: row.componentName,
      component_category: row.componentCategory,
      specification: row.specification,
      quantity_per_unit: quantity.quantity.toFixed(3),
      uom: quantity.uom,
      scrap_factor_percent: scrapFactor(row.componentCategory).toFixed(2),
      production_stage: stageFor(row.componentName, row.componentCategory),
      effective_from: '2025-01-01',
      effective_to: null,
      status: 'Active',
      remarks: `Imported from ${path.basename(workbookPath)} sheet ${row.sheet}`,
      created_at: '2025-01-01 09:00:00',
      updated_at: '2025-01-01 09:00:00',
    };
  });

  const insertColumns = [
    'bom_id',
    'bom_code',
    'parent_item_id',
    'component_item_id',
    'component_name',
    'component_category',
    'specification',
    'quantity_per_unit',
    'uom',
    'scrap_factor_percent',
    'production_stage',
    'effective_from',
    'effective_to',
    'status',
    'remarks',
    'created_at',
    'updated_at',
  ];

  const sqlLines = [
    'SET FOREIGN_KEY_CHECKS = 0;',
    'TRUNCATE TABLE bom_master;',
    'SET FOREIGN_KEY_CHECKS = 1;',
    `INSERT INTO bom_master (${insertColumns.join(', ')}) VALUES`,
    rows.map((row) => `  (${insertColumns.map((column) => sqlString(row[column])).join(', ')})`).join(',\n') + ';',
    '',
  ];
  const csvLines = [
    insertColumns.join(','),
    ...rows.map((row) => insertColumns.map((column) => csvCell(row[column])).join(',')),
  ];

  fs.writeFileSync(sqlOutputPath, sqlLines.join('\n'));
  fs.writeFileSync(csvOutputPath, csvLines.join('\n'));

  console.log(`Generated ${rows.length} bom_master rows from ${workbookPath}`);
  console.log(sqlOutputPath);
  console.log(csvOutputPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
