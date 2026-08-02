import { inject, injectable } from 'tsyringe';
import { ISnapshotRepository } from '../domain/interfaces';
import { computeRenderedHash } from '../domain/snapshot-ceremony';

@injectable()
export class SnapshotService {
  constructor(@inject('ISnapshotRepository') private readonly repo: ISnapshotRepository) {}

  async capture(tenantId: string, data: any) {
    const renderedHash = computeRenderedHash(JSON.stringify(data));
    return this.repo.create(tenantId, { ...data, renderedHash });
  }

  async primarySign(tenantId: string, id: string, data: any) { return this.repo.primarySign(tenantId, id, data); }
  async secondarySign(tenantId: string, id: string, data: any) { return this.repo.secondarySign(tenantId, id, data); }
  async verify(tenantId: string, id: string) { return this.repo.verify(tenantId, id); }
}
