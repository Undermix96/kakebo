import * as XLSX from 'xlsx';
import type { Workbook } from './build.ts';
import type { Grid } from './parse.ts';

/** Sheets read from the workbook (the others, many of them hidden and with broken pivot caches, are not parsed). */
export const NEEDED = /^(calcolo\s+(new\s+)?10\s|scadenze$|debiti$)/i;

/** Wraps a SheetJS workbook: computed values only, grid starting at A1. */
export function fromSheetJS(wb: XLSX.WorkBook): Workbook {
  return {
    sheetNames: wb.SheetNames,
    grid(name: string): Grid {
      const ws = wb.Sheets[name];
      if (!ws?.['!ref']) return [];
      const range = XLSX.utils.decode_range(ws['!ref']);
      range.s = { r: 0, c: 0 };
      return XLSX.utils.sheet_to_json<Grid[number]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range });
    },
  };
}

export function readWorkbook(data: Uint8Array): Workbook {
  // First pass: only the sheet names (cheap); then only the sheets we need.
  const names = XLSX.read(data, { type: 'array', bookSheets: true }).SheetNames;
  const wb = XLSX.read(data, {
    type: 'array',
    sheets: names.filter((n) => NEEDED.test(n.trim())),
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
  });
  return fromSheetJS({ ...wb, SheetNames: names });
}
