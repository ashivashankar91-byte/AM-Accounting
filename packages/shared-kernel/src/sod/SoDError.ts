export class SoDError extends Error {
  constructor(public readonly code: string, public readonly violations: { ruleId: string; description: string }[] = []) {
    super(`SoD violation: ${code}`);
    this.name = 'SoDError';
  }
}
