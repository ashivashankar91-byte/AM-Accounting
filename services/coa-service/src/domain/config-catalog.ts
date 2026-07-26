/**
 * S223 — Configuration Framework value typing & validation.
 *
 * Config values are stored as strings and typed by their catalog `type`.
 * Validation here is the single source of truth used by BOTH read and write
 * paths (packet §7 forbids validation logic diverging from the write path).
 */

export type ConfigType = 'BOOL' | 'INT' | 'ENUM' | 'STRING';
export type ConfigScope = 'TENANT' | 'ENTITY' | 'STORE';
export type ResolvedScope = ConfigScope | 'DEFAULT';
export type ConfigStatus = 'SCHEDULED' | 'EFFECTIVE' | 'SUPERSEDED';

export const CONFIG_SCOPES: readonly ConfigScope[] = ['TENANT', 'ENTITY', 'STORE'] as const;

/** Scope specificity order used by resolution: most specific first. */
export const SCOPE_ORDER: readonly ConfigScope[] = ['STORE', 'ENTITY', 'TENANT'] as const;

/**
 * Validate a raw string value against its declared type.
 * @returns null if valid, or a human-readable reason string if invalid (=> 422).
 */
export function validateTypedValue(
  type: ConfigType,
  value: string,
  enumValues: readonly string[] = [],
): string | null {
  if (value === undefined || value === null) return 'value is required';
  switch (type) {
    case 'BOOL':
      return value === 'true' || value === 'false'
        ? null
        : `BOOL value must be 'true' or 'false' (got '${value}')`;
    case 'INT':
      return /^-?\d+$/.test(value)
        ? null
        : `INT value must be an integer (got '${value}')`;
    case 'ENUM':
      return enumValues.includes(value)
        ? null
        : `ENUM value must be one of [${enumValues.join(', ')}] (got '${value}')`;
    case 'STRING':
      return value.length > 0 ? null : 'STRING value must be non-empty';
    default:
      return `unknown type '${type}'`;
  }
}

/** Validate that a scope is permitted for a key and that required dimensions are present. */
export function validateScope(
  scope: string,
  allowedScope: readonly string[],
  entityId?: string | null,
  storeId?: string | null,
): string | null {
  if (!CONFIG_SCOPES.includes(scope as ConfigScope)) {
    return `scope must be one of [${CONFIG_SCOPES.join(', ')}] (got '${scope}')`;
  }
  if (!allowedScope.includes(scope)) {
    return `scope '${scope}' is not permitted for this key (allowed: [${allowedScope.join(', ')}])`;
  }
  if ((scope === 'ENTITY' || scope === 'STORE') && !entityId) {
    return `entityId is required for scope '${scope}'`;
  }
  if (scope === 'STORE' && !storeId) {
    return `storeId is required for scope 'STORE'`;
  }
  return null;
}
