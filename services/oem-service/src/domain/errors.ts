export class OemNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'OemNotFoundError';
  }
}

export class OemValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OemValidationError';
  }
}

/** S104: "activated author != activator" — a real SoD boundary. */
export class OemSeparationOfDutiesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OemSeparationOfDutiesError';
  }
}
