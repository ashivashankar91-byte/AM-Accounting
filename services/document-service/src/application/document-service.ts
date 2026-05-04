import { PrismaClient } from '.prisma/document-client';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';

const logger = pino({ name: 'document-service' });
const GL_SERVICE_URL = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
const UPLOAD_DIR = process.env['UPLOAD_DIR'] ?? '/tmp/amacc-uploads';

export class DocumentService {
  private anthropic: Anthropic;

  constructor(private readonly prisma: PrismaClient) {
    this.anthropic = new Anthropic({
      apiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
    });

    // Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
  }

  async upload(tenantId: string, fileName: string, mimeType: string, fileBuffer: Buffer): Promise<{ documentId: string }> {
    const id = crypto.randomUUID();
    const ext = path.extname(fileName) || '.pdf';
    const filePath = path.join(UPLOAD_DIR, `${id}${ext}`);
    fs.writeFileSync(filePath, fileBuffer);

    const doc = await this.prisma.document.create({
      data: {
        tenantId,
        fileName,
        mimeType,
        filePath,
        status: 'UPLOADED',
      },
    });

    // Process asynchronously
    this.processDocument(doc.id, tenantId, filePath, mimeType).catch((err) => {
      logger.error({ docId: doc.id, err: (err as Error).message }, 'Document processing failed');
    });

    return { documentId: doc.id };
  }

  private async processDocument(docId: string, tenantId: string, filePath: string, mimeType: string) {
    await this.prisma.document.update({
      where: { id: docId },
      data: { status: 'PROCESSING' },
    });

    try {
      // Read file and encode as base64
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      const mediaType = mimeType === 'application/pdf' ? 'application/pdf' as const
        : mimeType.startsWith('image/') ? mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
        : 'image/jpeg' as const;

      // Call Claude to extract invoice data
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as any,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: `Extract all data from this vendor invoice. Return a JSON object with these fields:
{
  "vendorName": "string",
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null",
  "paymentTerms": "string or null",
  "lineItems": [
    {
      "description": "string",
      "quantity": number,
      "unitPrice": number,
      "total": number,
      "glAccountSuggestion": "string or null"
    }
  ],
  "subtotal": number,
  "tax": number,
  "total": number,
  "notes": "string or null"
}

Return ONLY the JSON object, no other text.`,
            },
          ],
        }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      const extractedText = textContent?.type === 'text' ? textContent.text : '{}';

      let extractedData: any;
      try {
        // Try to parse the JSON, handling potential markdown code fences
        const jsonStr = extractedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        extractedData = JSON.parse(jsonStr);
      } catch {
        extractedData = { raw: extractedText, parseError: true };
      }

      // Look up historical GL coding for this vendor
      const suggestedCoding = await this.suggestGLCoding(tenantId, extractedData.vendorName);

      await this.prisma.document.update({
        where: { id: docId },
        data: {
          status: 'EXTRACTED',
          extractedData: extractedData as any,
          suggestedCoding: suggestedCoding as any,
          vendorName: extractedData.vendorName ?? null,
          invoiceNumber: extractedData.invoiceNumber ?? null,
          invoiceDate: extractedData.invoiceDate ? new Date(extractedData.invoiceDate) : null,
          totalAmount: extractedData.total ?? null,
        },
      });

      logger.info({ docId, vendor: extractedData.vendorName }, 'Document extracted successfully');
    } catch (err) {
      await this.prisma.document.update({
        where: { id: docId },
        data: { status: 'FAILED', extractedData: { error: (err as Error).message } as any },
      });
      throw err;
    }
  }

  private async suggestGLCoding(tenantId: string, vendorName: string | undefined): Promise<Record<string, string>> {
    if (!vendorName) return {};

    try {
      // Get recent journal entries from this vendor to suggest GL coding
      const resp = await fetch(
        `${GL_SERVICE_URL}/api/v1/gl/journal-entries?source=CONNECTOR_AP&limit=20`,
        { headers: { 'x-tenant-id': tenantId } },
      );
      if (!resp.ok) return {};

      const entries = (await resp.json()) as any[];
      const vendorEntries = entries.filter((e) =>
        e.description?.toLowerCase().includes(vendorName.toLowerCase()),
      );

      // Find most commonly used GL accounts for this vendor
      const accountCounts = new Map<string, number>();
      for (const entry of vendorEntries) {
        for (const line of (entry.lines ?? [])) {
          if (line.debit > 0 && line.accountCode) {
            const count = accountCounts.get(line.accountCode) ?? 0;
            accountCounts.set(line.accountCode, count + 1);
          }
        }
      }

      const sorted = [...accountCounts.entries()].sort((a, b) => b[1] - a[1]);
      const suggestions: Record<string, string> = {};
      if (sorted.length > 0) {
        suggestions.primaryAccount = sorted[0][0];
        suggestions.confidence = sorted.length > 2 ? 'HIGH' : sorted.length > 0 ? 'MEDIUM' : 'LOW';
        suggestions.basedOn = `${vendorEntries.length} prior invoices`;
      }

      return suggestions;
    } catch {
      return {};
    }
  }

  async getDocument(docId: string, tenantId: string) {
    return this.prisma.document.findFirst({
      where: { id: docId, tenantId },
    });
  }

  async approve(docId: string, tenantId: string, approvedBy: string): Promise<{ journalEntryId: string }> {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, tenantId, status: 'EXTRACTED' },
    });
    if (!doc) throw new Error('Document not found or not ready for approval');

    const extracted = doc.extractedData as any;
    if (!extracted?.lineItems?.length) throw new Error('No line items extracted');

    // Resolve GL accounts
    const accountsResp = await fetch(`${GL_SERVICE_URL}/api/v1/gl/accounts`, {
      headers: { 'x-tenant-id': tenantId },
    });
    if (!accountsResp.ok) throw new Error('Failed to fetch GL accounts');
    const accounts = (await accountsResp.json()) as any[];
    const codeToId = new Map(accounts.map((a: any) => [a.code, a.id]));

    // Build journal lines
    const suggestedCode = (doc.suggestedCoding as any)?.primaryAccount ?? '6100';
    const expenseAcctId = codeToId.get(suggestedCode) ?? codeToId.get('6100');
    const apAcctId = codeToId.get('2000');

    if (!expenseAcctId || !apAcctId) throw new Error('Required GL accounts not found');

    const totalAmount = extracted.total ?? extracted.lineItems.reduce((s: number, l: any) => s + (l.total ?? 0), 0);
    const lines = [
      {
        glAccountId: expenseAcctId,
        debit: totalAmount,
        credit: 0,
        memo: `AP Invoice ${extracted.invoiceNumber} - ${extracted.vendorName}`,
        moduleSource: 'DOCUMENT_OCR',
      },
      {
        glAccountId: apAcctId,
        debit: 0,
        credit: totalAmount,
        memo: `AP - ${extracted.vendorName} - ${extracted.invoiceNumber}`,
        moduleSource: 'DOCUMENT_OCR',
      },
    ];

    // Create journal entry
    const entryResp = await fetch(`${GL_SERVICE_URL}/api/v1/gl/journal-entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      body: JSON.stringify({
        entryDate: extracted.invoiceDate ?? new Date().toISOString().split('T')[0],
        description: `AP Invoice - ${extracted.vendorName} - ${extracted.invoiceNumber}`,
        source: 'DOCUMENT_OCR',
        sourceRef: extracted.invoiceNumber,
        lines,
      }),
    });

    if (!entryResp.ok) {
      const text = await entryResp.text();
      throw new Error(`Failed to create GL entry: ${text}`);
    }

    const entry = await entryResp.json() as { id: string };

    await this.prisma.document.update({
      where: { id: docId },
      data: {
        status: 'APPROVED',
        approvedBy,
        approvedAt: new Date(),
        journalEntryId: entry.id,
      },
    });

    logger.info({ docId, entryId: entry.id }, 'Document approved and posted to GL');
    return { journalEntryId: entry.id };
  }

  async listDocuments(tenantId: string, status?: string) {
    const where: any = { tenantId };
    if (status) where.status = status;
    return this.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
