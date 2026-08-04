/**
 * S005 — IAuthServiceClient
 *
 * Port for creating and deprovisioning accounting users via the auth-service.
 * All implementations must propagate errors — no swallowed failures.
 */

export interface ProvisionedUser {
  userId: string;
  email: string;
  assignedRoles: string[];
}

export interface IAuthServiceClient {
  /** Joiner: create user and assign accounting roles. Idempotent on (tenantId, email). */
  provisionUser(params: {
    tenantId: string;
    legalEntityId: string;
    email: string;
    firstName: string;
    lastName: string;
    externalHrId: string;
    roles: string[];
    requestedBy: string;
  }): Promise<ProvisionedUser>;

  /** Mover: update role assignments for an existing user. */
  updateUserRoles(params: {
    tenantId: string;
    legalEntityId: string;
    externalHrId: string;
    roles: string[];
    requestedBy: string;
  }): Promise<void>;

  /** Leaver: deactivate account and revoke all role assignments. */
  deprovisionUser(params: {
    tenantId: string;
    legalEntityId: string;
    externalHrId: string;
    requestedBy: string;
  }): Promise<void>;
}

/** HTTP adapter that calls auth-service REST API. */
export class HttpAuthServiceClient implements IAuthServiceClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(opts: { baseUrl: string; serviceToken: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.serviceToken = opts.serviceToken;
  }

  private headers(tenantId: string) {
    return {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      'Authorization': `Bearer ${this.serviceToken}`,
      'x-service-identity': 'tenant-service:hr-provisioning',
    };
  }

  private async request(method: string, path: string, tenantId: string, body?: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(tenantId),
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`auth-service ${method} ${path} → ${res.status}: ${text}`);
      (err as any).statusCode = res.status;
      (err as any).retryable = res.status >= 500;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async provisionUser(p: Parameters<IAuthServiceClient['provisionUser']>[0]): Promise<ProvisionedUser> {
    const data = await this.request('POST', '/api/v1/iam/users/provision', p.tenantId, {
      email: p.email,
      firstName: p.firstName,
      lastName: p.lastName,
      externalHrId: p.externalHrId,
      legalEntityId: p.legalEntityId,
      roles: p.roles,
      requestedBy: p.requestedBy,
    });
    return { userId: data.id, email: data.email, assignedRoles: data.roles ?? p.roles };
  }

  async updateUserRoles(p: Parameters<IAuthServiceClient['updateUserRoles']>[0]): Promise<void> {
    await this.request('PATCH', `/api/v1/iam/users/by-external-id/${encodeURIComponent(p.externalHrId)}/roles`, p.tenantId, {
      legalEntityId: p.legalEntityId,
      roles: p.roles,
      requestedBy: p.requestedBy,
    });
  }

  async deprovisionUser(p: Parameters<IAuthServiceClient['deprovisionUser']>[0]): Promise<void> {
    await this.request('POST', `/api/v1/iam/users/by-external-id/${encodeURIComponent(p.externalHrId)}/deprovision`, p.tenantId, {
      legalEntityId: p.legalEntityId,
      requestedBy: p.requestedBy,
    });
  }
}
