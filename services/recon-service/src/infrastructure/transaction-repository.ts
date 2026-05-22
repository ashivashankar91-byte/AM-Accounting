import { injectable, inject } from 'tsyringe';
import { IBankTransactionRepository, BankTransaction, BankTransactionStatus } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/recon-client';
import type { BankTransaction as PrismaBankTransaction } from '.prisma/recon-client';

@injectable()
export class PrismaBankTransactionRepository implements IBankTransactionRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findByReconId(reconId: string): Promise<BankTransaction[]> {
    const rows = await this.prisma.bankTransaction.findMany({ where: { bankReconId: reconId } });
    return rows.map(this.toDomain);
  }

  async findUnmatched(reconId: string): Promise<BankTransaction[]> {
    const rows = await this.prisma.bankTransaction.findMany({
      where: { bankReconId: reconId, status: 'UNMATCHED' },
    });
    return rows.map(this.toDomain);
  }

  async create(data: Omit<BankTransaction, 'id'>): Promise<BankTransaction> {
    const row = await this.prisma.bankTransaction.create({ data });
    return this.toDomain(row);
  }

  async createMany(data: Omit<BankTransaction, 'id'>[]): Promise<number> {
    const result = await this.prisma.bankTransaction.createMany({ data });
    return result.count;
  }

  async match(id: string, journalLineId: string): Promise<BankTransaction> {
    const row = await this.prisma.bankTransaction.update({
      where: { id },
      data: { matchedJournalLineId: journalLineId, status: 'MATCHED' },
    });
    return this.toDomain(row);
  }

  private toDomain(row: PrismaBankTransaction): BankTransaction {
    return {
      id: row.id, bankReconId: row.bankReconId,
      transactionDate: row.transactionDate, description: row.description,
      amount: row.amount, matchedJournalLineId: row.matchedJournalLineId,
      status: row.status as BankTransactionStatus,
    };
  }
}
