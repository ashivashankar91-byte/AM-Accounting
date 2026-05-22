import { inject, injectable } from 'tsyringe';
import {
  IBankReconRepository,
  IBankTransactionRepository,
  IEventPublisher,
  BankRecon,
  BankTransaction,
  TenantId,
  ReconStatus,
  BankTransactionStatus,
} from '@amacc/shared-kernel';
import { createEvent } from '@amacc/shared-kernel';

@injectable()
export class ReconService {
  constructor(
    @inject('IBankReconRepository') private readonly reconRepo: IBankReconRepository,
    @inject('IBankTransactionRepository') private readonly txnRepo: IBankTransactionRepository,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async createRecon(data: Omit<BankRecon, 'id'>, tenantId: TenantId): Promise<BankRecon> {
    const recon = await this.reconRepo.create(data, tenantId);
    await this.eventPublisher.publish(
      createEvent('BANK_RECON_STARTED', tenantId, { reconId: recon.id }),
    );
    return recon;
  }

  async getRecons(tenantId: TenantId): Promise<BankRecon[]> {
    return this.reconRepo.findAll(tenantId);
  }

  async importTransactions(reconId: string, tenantId: TenantId, transactions: Omit<BankTransaction, 'id'>[]): Promise<number> {
    return this.txnRepo.createMany(transactions);
  }

  async getUnmatched(reconId: string): Promise<BankTransaction[]> {
    return this.txnRepo.findUnmatched(reconId);
  }

  async matchManual(transactionId: string, journalLineId: string): Promise<BankTransaction> {
    return this.txnRepo.match(transactionId, journalLineId);
  }

  async completeRecon(id: string, tenantId: TenantId): Promise<BankRecon> {
    return this.reconRepo.update(id, { status: ReconStatus.COMPLETED }, tenantId);
  }
}
