import {
  formatBusinessDate,
  formatKmf,
  NBSP,
  type ReportColumn,
  type ReportView,
} from '@digecom/shared';
import ExcelJS from 'exceljs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';

const BLUE = '#0B2FE0';
const ORANGE = '#FFA500';
const INK = '#0F1535';
const MUTED = '#4A5275';
/** Format Excel des montants : séparateur de milliers, entiers KMF. */
export const KMF_FORMAT = '#,##0 "KMF"';
const INT_FORMAT = '#,##0';

/** Logo Dig'eCom (docs/brand), facultatif. */
function logo(): Buffer | null {
  for (const p of [
    join(process.cwd(), 'assets', 'logo-digecom.jpg'),
    join(process.cwd(), '..', '..', 'docs', 'brand', 'logo-digecom.jpg'),
    join(process.cwd(), 'docs', 'brand', 'logo-digecom.jpg'),
  ]) {
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

/** Entier avec espaces simples (PDFKit n'affiche pas les espaces insécables). */
const formatInt = (n: number) =>
  n
    .toLocaleString('fr-FR')
    .split('')
    .map((ch) => (ch.charCodeAt(0) === 0xa0 || ch.charCodeAt(0) === 0x202f ? ' ' : ch))
    .join('');

const cellText = (c: ReportColumn, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (c.kind === 'kmf') return formatKmf(Number(v)).split(NBSP).join(' ');
  if (c.kind === 'int') return formatInt(Number(v));
  if (c.kind === 'pct') return `${String(v).replace('.', ',')} %`;
  if (c.kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
    return formatBusinessDate(v);
  return String(v);
};

/** XLSX : en-têtes en gras, montants au format KMF, formules de totaux, onglet des paramètres. */
export async function renderReportXlsx(r: ReportView): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dig'eCom";
  wb.created = new Date(r.generatedAt);
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.columns = r.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(40, c.label.length + 4)),
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECFD' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of r.rows) {
    ws.addRow(
      Object.fromEntries(
        r.columns.map((c) => {
          const v = row[c.key];
          if (c.kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
            return [c.key, new Date(`${v}T00:00:00Z`)];
          return [c.key, v ?? null];
        }),
      ),
    );
  }
  r.columns.forEach((c, i) => {
    const column = ws.getColumn(i + 1);
    if (c.kind === 'kmf') column.numFmt = KMF_FORMAT;
    if (c.kind === 'int') column.numFmt = INT_FORMAT;
    if (c.kind === 'date') column.numFmt = 'dd/mm/yyyy';
  });
  if (r.columns.some((c) => c.total)) {
    const last = r.rows.length + 1;
    const total = ws.addRow({});
    total.font = { bold: true };
    total.getCell(1).value = 'Total';
    r.columns.forEach((c, i) => {
      if (!c.total) return;
      const letter = ws.getColumn(i + 1).letter;
      total.getCell(i + 1).value = {
        formula: r.rows.length ? `SUM(${letter}2:${letter}${last})` : '0',
        result: r.totals[c.key] ?? 0,
      };
    });
  }
  const params = wb.addWorksheet('Paramètres du rapport');
  params.columns = [
    { header: 'Paramètre', key: 'label', width: 24 },
    { header: 'Valeur', key: 'value', width: 50 },
  ];
  params.getRow(1).font = { bold: true };
  for (const p of r.params) params.addRow(p);
  params.addRow({
    label: 'Généré le',
    value: new Date(r.generatedAt).toLocaleString('fr-FR', { timeZone: 'Indian/Comoro' }),
  });
  params.addRow({ label: 'Lignes', value: String(r.rows.length) });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF A4 paysage : en-tête avec logo, tableau, totaux, pagination. */
export function renderReportPdf(r: ReportView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
      bufferPages: true,
      info: { Title: r.title, Author: "Dig'eCom" },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const image = logo();
    const header = () => {
      doc.rect(0, 0, doc.page.width, 64).fill(BLUE);
      doc.circle(doc.page.width - 30, 6, 44).fill(ORANGE);
      if (image) doc.image(image, 36, 12, { height: 40 });
      doc
        .fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text("Dig'eCom", image ? 86 : 36, 16);
      doc
        .font('Helvetica')
        .fontSize(10)
        .text(r.title, image ? 86 : 36, 40);
      doc.fillColor(INK);
      doc.y = 80;
    };
    header();
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(r.params.map((p) => `${p.label} : ${p.value}`).join('   ·   '), 36, 76, {
      width: doc.page.width - 72,
    });
    doc.moveDown(0.8);

    const width = doc.page.width - 72;
    const weights = r.columns.map((c) => (c.kind === 'text' ? 2 : 1));
    const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / sum) * width);
    const line = (cells: string[], bold: boolean, fill?: string) => {
      const h = 16;
      if (doc.y + h > doc.page.height - 40) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      if (fill) doc.rect(36, y - 2, width, h).fill(fill);
      let x = 36;
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .fillColor(INK);
      cells.forEach((text, i) => {
        const right = r.columns[i]!.kind !== 'text' && r.columns[i]!.kind !== 'date';
        doc.text(text, x + 2, y + 2, {
          width: widths[i]! - 4,
          align: right ? 'right' : 'left',
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[i]!;
      });
      doc.y = y + h;
    };
    line(
      r.columns.map((c) => c.label),
      true,
      '#E8ECFD',
    );
    r.rows.forEach((row, i) =>
      line(
        r.columns.map((c) => cellText(c, row[c.key])),
        false,
        i % 2 ? '#F6F7FB' : undefined,
      ),
    );
    if (r.columns.some((c) => c.total))
      line(
        r.columns.map((c, i) =>
          i === 0 ? 'Total' : c.total ? cellText(c, r.totals[c.key] ?? 0) : '',
        ),
        true,
        '#FFF3DC',
      );

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(MUTED)
        .text(`Page ${i + 1} / ${range.count}`, 36, doc.page.height - 28, {
          width: doc.page.width - 72,
          align: 'right',
          lineBreak: false,
        });
    }
    doc.end();
  });
}
