import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { catalogImportSchema } from '@kakebo/core';
import { buildHistory, type ImportConfig } from './build.ts';
import { readWorkbook } from './workbook.ts';

/**
 * Reads the old spreadsheet and writes a history file for the app (Impostazioni →
 * Carica lo storico) plus a reconciliation report. Inputs and outputs stay in
 * private/: the repository is public.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const priv = path.join(root, 'private');
const { values } = parseArgs({
  options: {
    xlsx: { type: 'string', default: path.join(priv, 'kakebo.xlsx') },
    catalog: { type: 'string', default: path.join(priv, 'fixtures', 'catalog-2026-11.json') },
    config: { type: 'string', default: path.join(priv, 'import-xlsx.config.json') },
    out: { type: 'string', default: path.join(priv, 'history.json') },
    report: { type: 'string', default: path.join(priv, 'history-report.md') },
  },
});

const inside = (p: string) => {
  const rel = path.relative(priv, path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); // another drive gives an absolute path
};
for (const p of [values.out!, values.report!]) {
  if (!inside(p)) {
    console.error(`refusing to write outside private/: ${p}`);
    process.exit(2);
  }
}
for (const [what, p] of [['spreadsheet', values.xlsx!], ['catalog', values.catalog!]] as const) {
  if (!fs.existsSync(p)) {
    console.error(`${what} not found: ${p}`);
    process.exit(2);
  }
}

const catalog = catalogImportSchema.parse(JSON.parse(fs.readFileSync(values.catalog!, 'utf8')));
const config: ImportConfig = fs.existsSync(values.config!) ? JSON.parse(fs.readFileSync(values.config!, 'utf8')) : {};
const book = readWorkbook(new Uint8Array(fs.readFileSync(values.xlsx!)));
const { history, report } = buildHistory(book, catalog, config);

fs.writeFileSync(values.out!, JSON.stringify(history, null, 2) + '\n');
fs.writeFileSync(values.report!, report + '\n');
console.log(`${history.cycles.length} cycles, ${history.debts.length} debts, ${history.calendarEvents.length} dates`);
console.log(`history: ${path.relative(root, values.out!)}`);
console.log(`report:  ${path.relative(root, values.report!)} (read it before loading the file in the app)`);
