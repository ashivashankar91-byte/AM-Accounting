/** Blanket-permissive fake service: any method call resolves to `{}` (or an
 * empty array where the caller expects a list — good enough for
 * `.catch(() => [])` shaped call sites since the Promise itself resolves,
 * never rejects). Used where a permission test only needs the guard's ALLOW
 * path to reach a non-401/403 response, not to exercise business logic
 * already covered by that service's own application-layer test file
 * (test-payroll-service.ts, test-commission-service.ts,
 * test-rule-pack-service.ts). Mirrors
 * coa-service/tests/support/fake-authz-client.ts's permissiveFakeService. */
export function permissiveFakeService(): any {
  return new Proxy(
    {},
    {
      get: () => async () => ({}),
    },
  );
}
