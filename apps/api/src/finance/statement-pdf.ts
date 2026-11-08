import {
  formatBusinessDate,
  formatBusinessDateTime,
  formatKmf,
  formatPhone,
  NBSP,
  SETTLEMENT_STATUS_LABELS,
  type SettlementView,
} from '@digecom/shared';
import PDFDocument from 'pdfkit';

const BLUE = '#0B2FE0';
const ORANGE = '#FFA500';
const INK = '#0F1535';
const MUTED = '#4A5275';
/** PDFKit (police standard Helvetica) n'affiche pas l'espace insécable fine : espace simple. */
const kmf = (n: number) => formatKmf(n).split(NBSP).join(' ');

/** Relevé de règlement d'un e-commerçant (PDF A4). */
export function renderStatementPdf(s: SettlementView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: `Relevé ${s.number}`, Author: "Dig'eCom" },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 90).fill(BLUE);
    doc.circle(doc.page.width - 40, 10, 60).fill(ORANGE);
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text("Dig'eCom", 48, 30);
    doc.fontSize(11).font('Helvetica').text('Relevé de règlement e-commerçant', 48, 58);

    doc.fillColor(INK).moveDown(3);
    doc.font('Helvetica-Bold').fontSize(14).text(`Relevé ${s.number}`, 48, 120);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    doc.text(
      `Période : du ${formatBusinessDate(s.periodStart)} au ${formatBusinessDate(s.periodEnd)}`,
    );
    doc.text(
      `E-commerçant : ${s.seller.fullName} · ${formatPhone(s.seller.phone)} · ${s.island.name}`,
    );
    doc.text(`Statut : ${SETTLEMENT_STATUS_LABELS[s.status]}`);
    doc.moveDown();

    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(INK)
        .fontSize(11);
      doc.text(label, 48, y, { width: 330 });
      doc.text(value, 380, y, { width: 167, align: 'right' });
      doc.moveDown(0.4);
    };
    row(`Commissions (${s.salesCount} vente(s))`, kmf(s.grossCommission));
    row('Taxes e-commerçant', `− ${kmf(s.taxes)}`);
    row('Abonnements', `− ${kmf(s.subscriptions)}`);
    row('Autres retenues', `− ${kmf(s.otherDeductions)}`);
    if (s.carriedOver) row('Report du cycle précédent', kmf(s.carriedOver));
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#E1E5F2').stroke().moveDown(0.5);
    row('Net à payer', kmf(s.netToPay), true);
    if (s.balance < 0) row('Solde reporté au prochain cycle', kmf(s.balance));
    doc.moveDown();

    if (s.lines?.length) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Détail', 48);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9);
      for (const l of s.lines) {
        const y = doc.y;
        if (y > 760) doc.addPage();
        doc
          .fillColor(MUTED)
          .text(formatBusinessDate(l.periodDate), 48, doc.y, { width: 70, continued: false });
        const yy = doc.y - 11;
        doc
          .fillColor(INK)
          .text(`${l.label}${l.orderNumber ? ` · ${l.orderNumber}` : ''}`, 120, yy, { width: 300 });
        doc.text(kmf(l.amount), 420, yy, { width: 127, align: 'right' });
      }
    }

    doc.moveDown(2).font('Helvetica').fontSize(9).fillColor(MUTED);
    const trail = [
      s.verifiedBy
        ? `Vérifié par ${s.verifiedBy.fullName} le ${formatBusinessDateTime(s.verifiedAt!)}`
        : null,
      s.approvedBy
        ? `Validé par ${s.approvedBy.fullName} le ${formatBusinessDateTime(s.approvedAt!)}`
        : null,
      s.paidBy
        ? `Payé par ${s.paidBy.fullName} le ${formatBusinessDateTime(s.paidAt!)} (${s.paymentMethod}${s.paymentRef ? ` · ${s.paymentRef}` : ''})`
        : null,
    ].filter(Boolean);
    for (const t of trail) doc.text(t!, 48);
    doc.end();
  });
}
