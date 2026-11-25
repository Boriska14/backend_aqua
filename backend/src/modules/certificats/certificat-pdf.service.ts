import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';

export interface CertificatPdfPayload {
  number: string;
  aquasafeNumber: string;
  ouvrageName: string;
  village: string | null;
  communeName: string;
  referentiel: string;
  issuedAt: Date;
  validFrom: Date;
  validUntil: Date;
  qrToken: string;
  lang?: 'fr' | 'en';
}

@Injectable()
export class CertificatPdfService {
  private readonly publicVerifyUrl: string;

  constructor(configService: ConfigService) {
    this.publicVerifyUrl =
      configService.getOrThrow<string>('PUBLIC_VERIFY_URL');
  }

  async render(data: CertificatPdfPayload): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const verifyUrl = `${this.publicVerifyUrl.replace(/\/$/, '')}/${data.qrToken}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    });
    const qrBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
    const qrImage = await pdfDoc.embedPng(qrBytes);

    // Watermark across page (mandatory wording)
    page.drawText('AQUASAFE - PILOTE EN COURS DE VALIDATION', {
      x: 75,
      y: 260,
      size: 24,
      font: fontBold,
      color: rgb(0.88, 0.9, 0.93),
      rotate: degrees(38),
    });

    // Header
    page.drawRectangle({
      x: 40,
      y: 745,
      width: 515,
      height: 62,
      color: rgb(0.04, 0.24, 0.42),
    });

    const isEn = data.lang === 'en';
    const title = isEn
      ? 'CERTIFICATE OF CONFORMITY / CERTIFICAT DE CONFORMITE'
      : 'CERTIFICAT DE CONFORMITE / CERTIFICATE OF CONFORMITY';

    page.drawText('AQUASAFE CAMEROUN', {
      x: 56,
      y: 785,
      size: 16,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    page.drawText(title, {
      x: 56,
      y: 760,
      size: 11,
      font: fontBold,
      color: rgb(0.82, 0.92, 1),
    });

    page.drawText('Pilote en cours de validation / Pilot under validation', {
      x: 40,
      y: 722,
      size: 10,
      font: fontBold,
      color: rgb(0.7, 0.2, 0.1),
    });

    const lines = [
      `N° Certificat / Certificate No: ${data.number}`,
      `Ouvrage / Water Point ID: ${data.aquasafeNumber}`,
      `Nom / Name: ${data.ouvrageName}`,
      `Village / Locality: ${data.village ?? '-'}`,
      `Commune / Municipality: ${data.communeName}`,
      `Referentiel / Standard: ${data.referentiel}`,
      `Date d'emission / Issued (UTC): ${data.issuedAt.toISOString().slice(0, 10)}`,
      `Valide du / Valid from: ${data.validFrom.toISOString().slice(0, 10)}`,
      `Valide jusqu'au / Valid until: ${data.validUntil.toISOString().slice(0, 10)}`,
    ];

    lines.forEach((line, i) => {
      page.drawText(line, {
        x: 44,
        y: 675 - i * 28,
        size: 12,
        font: i === 0 ? fontBold : font,
        color: rgb(0.1, 0.12, 0.16),
      });
    });

    // Bilingual compliance note (never "garanti potable")
    page.drawText(
      "FR: Ce certificat de conformite atteste la conformite de l'echantillon analyse aux parametres du referentiel indique a la date du controle.",
      {
        x: 44,
        y: 380,
        size: 9.5,
        font,
        maxWidth: 505,
        color: rgb(0.25, 0.25, 0.25),
      },
    );
    page.drawText(
      'EN: This certificate of conformity attests that the tested sample complies with the parameters of the stated standard as of the inspection date.',
      {
        x: 44,
        y: 345,
        size: 9.5,
        font,
        maxWidth: 505,
        color: rgb(0.25, 0.25, 0.25),
      },
    );

    page.drawImage(qrImage, {
      x: 405,
      y: 120,
      width: 145,
      height: 145,
    });
    page.drawText(`Verification: ${verifyUrl}`, {
      x: 44,
      y: 140,
      size: 9,
      font,
      maxWidth: 340,
      color: rgb(0.2, 0.3, 0.45),
    });

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  }
}
