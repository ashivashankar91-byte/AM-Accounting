export class VehicleAccountingInputError extends Error {
  readonly status = 400;
  readonly code = 'VEHICLE_ACCOUNTING_INPUT_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'VehicleAccountingInputError';
  }
}

export class UnitNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'UNIT_NOT_FOUND';
  constructor(idOrStockNumber: string) {
    super(`Vehicle unit "${idOrStockNumber}" not found.`);
    this.name = 'UnitNotFoundError';
  }
}

export class DuplicateStockNumberError extends Error {
  readonly status = 409;
  readonly code = 'DUPLICATE_STOCK_NUMBER';
  constructor(stockNumber: string) {
    super(`Stock number "${stockNumber}" is already in use for this tenant.`);
    this.name = 'DuplicateStockNumberError';
  }
}

export class IdempotencyConflictError extends Error {
  readonly status = 409;
  readonly code = 'IDEMPOTENCY_CONFLICT';
  constructor(key: string) {
    super(`Idempotency key "${key}" was already used with different request content.`);
    this.name = 'IdempotencyConflictError';
  }
}

export class TradeNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'TRADE_NOT_FOUND';
  constructor(idOrTradeNumber: string) {
    super(`Dealer trade "${idOrTradeNumber}" not found.`);
    this.name = 'TradeNotFoundError';
  }
}

export class TradeAlreadySettledError extends Error {
  readonly status = 409;
  readonly code = 'TRADE_ALREADY_SETTLED';
  constructor(tradeId: string) {
    super(`Dealer trade "${tradeId}" is already settled.`);
    this.name = 'TradeAlreadySettledError';
  }
}

export class AdjustmentNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'ADJUSTMENT_NOT_FOUND';
  constructor(id: string) {
    super(`Demo value adjustment "${id}" not found.`);
    this.name = 'AdjustmentNotFoundError';
  }
}

export class AdjustmentNotPendingError extends Error {
  readonly status = 422;
  readonly code = 'ADJUSTMENT_NOT_PENDING';
  constructor(id: string, status: string) {
    super(`Demo value adjustment "${id}" is "${status}" — only a PENDING_PREVIEW adjustment may be approved/rejected.`);
    this.name = 'AdjustmentNotPendingError';
  }
}

export class ConfigNotFoundError extends Error {
  readonly status = 422;
  readonly code = 'CONFIG_NOT_FOUND';
  constructor(message: string) {
    super(message);
    this.name = 'ConfigNotFoundError';
  }
}
