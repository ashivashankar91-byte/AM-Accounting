export type PreferenceRole =
  | 'CONTROLLER'
  | 'DEALER_PRINCIPAL'
  | 'SERVICE_MANAGER'
  | 'PARTS_MANAGER'
  | 'CASHIER'
  | 'ADMIN';

export const DEFAULT_LAYOUTS: Record<PreferenceRole, { widgets: string[] }> = {
  CONTROLLER: {
    widgets: [
      'trial-balance',
      'cash-flow-forecast',
      'eom-readiness',
      'pending-approvals',
      'agent-activity',
      'ai-narrative',
    ],
  },
  DEALER_PRINCIPAL: {
    widgets: [
      'gross-profit-by-dept',
      'vehicle-sales',
      'service-revenue',
      'cash-position',
      'top-alerts',
    ],
  },
  SERVICE_MANAGER: {
    widgets: [
      'tech-productivity',
      'open-ro-aging',
      'parts-margin',
      'warranty-aging',
    ],
  },
  PARTS_MANAGER: {
    widgets: [
      'parts-margin',
      'parts-inventory',
      'parts-orders',
      'parts-backorders',
    ],
  },
  CASHIER: {
    widgets: [
      'cash-receipts-today',
      'pending-deposits',
      'daily-balance',
    ],
  },
  ADMIN: {
    widgets: [
      'system-health',
      'active-users',
      'agent-activity',
      'compliance-alerts',
    ],
  },
};
