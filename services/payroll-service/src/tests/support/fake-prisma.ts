/** Blanket-permissive fake Prisma client: any `prisma.<model>.<method>(...)`
 * call resolves to a benign default (`[]` for `findMany`, `{}` otherwise) so
 * ce13-routes.ts's direct Prisma access (source-mode config, clawbacks,
 * accruals, tech-bridge — routes that don't go through an application
 * service) can be exercised purely for guard/permission behavior without
 * asserting business-logic response shape (already covered by
 * test-ce13-routes.ts against a purpose-built mock Prisma). */
export function fakePrisma(): any {
  return new Proxy(
    {},
    {
      get: () => new Proxy(
        {},
        {
          get: (_t, method: string) => async () => (method === 'findMany' ? [] : {}),
        },
      ),
    },
  );
}
