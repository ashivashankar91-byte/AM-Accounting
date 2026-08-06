import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';

// FINAL-R0 Step 4: real JWT auth context backing the browser Golden Path.
// Replaces the previous hardcoded 'tenant-kunes' localStorage fallback in
// api/client.ts with a real, user-driven login -> JWT -> Bearer-header flow
// against the real auth-service (S205) through the real gateway.

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

interface LoginResult {
  user: AuthUser;
  accessToken: string;
  tokenType: string;
  sessionToken: string;
  expiresAt: string;
}

interface AuthState {
  accessToken: string | null;
  tenantId: string | null;
  user: AuthUser | null;
  legalEntityId: string | null;
  legalEntityLabel: string | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  login: (tenantId: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  selectLegalEntity: (legalEntityId: string, legalEntityLabel: string) => void;
}

const STORAGE_KEYS = {
  accessToken: 'goldenpath.accessToken',
  sessionToken: 'goldenpath.sessionToken',
  tenantId: 'goldenpath.tenantId',
  user: 'goldenpath.user',
  legalEntityId: 'goldenpath.legalEntityId',
  // Golden R0 UI convergence (Phase 1): display label for the shell's
  // context bar, stored alongside the id selectLegalEntity already tracked.
  // Purely presentational — never used for API calls (those keep using
  // legalEntityId, the real tenant-service identifier).
  legalEntityLabel: 'goldenpath.legalEntityLabel',
} as const;

const USER_PERMISSIONS_KEY = 'userPermissions';

// fix(integration) — CE-13 UI closure: every page's client-side permission
// gating (payrollPermissions.ts, NavRail's hasNavPermission, etc.) reads
// this key, but nothing ever populated it — every gated action rendered
// disabled for every user regardless of real role. Backed by auth-service's
// new GET /authz/my-permissions (derived from the caller's own JWT-bound
// userId + authz_role_assignment/role_permission, never a query-supplied
// user), refreshed on login and whenever the entity scope changes (grants
// can be entity-scoped). This is UX only — every write endpoint still
// enforces its own server-side check() independent of this cache.
async function refreshPermissions(accessToken: string, tenantId: string, entityId: string | null): Promise<void> {
  try {
    const qs = entityId ? `?entity=${encodeURIComponent(entityId)}` : '';
    const res = await fetch(`/api/v1/authz/my-permissions${qs}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'x-tenant-id': tenantId },
    });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({ permissions: [] }));
    localStorage.setItem(USER_PERMISSIONS_KEY, JSON.stringify(Array.isArray(body.permissions) ? body.permissions : []));
  } catch {
    // Best-effort — a stale/empty permission cache degrades to "everything
    // gated off" in the UI, never to a false grant.
  }
}

function readInitialState(): AuthState {
  try {
    const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken);
    const tenantId = localStorage.getItem(STORAGE_KEYS.tenantId);
    const legalEntityId = localStorage.getItem(STORAGE_KEYS.legalEntityId);
    const legalEntityLabel = localStorage.getItem(STORAGE_KEYS.legalEntityLabel);
    const userRaw = localStorage.getItem(STORAGE_KEYS.user);
    const user = userRaw ? (JSON.parse(userRaw) as AuthUser) : null;
    return { accessToken, tenantId, user, legalEntityId, legalEntityLabel };
  } catch {
    return { accessToken: null, tenantId: null, user: null, legalEntityId: null, legalEntityLabel: null };
  }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(readInitialState);

  // Rehydration path: a hard page load (not the in-SPA login() flow) re-runs
  // readInitialState from localStorage, which already has an access token
  // from a prior login — but never refetches the permission cache, so a
  // reloaded/deep-linked page would otherwise see gated actions as
  // permanently disabled until the next explicit login()/selectLegalEntity()
  // call. Runs once per mount, only when already authenticated.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (rehydratedRef.current) return;
    rehydratedRef.current = true;
    if (state.accessToken && state.tenantId) {
      void refreshPermissions(state.accessToken, state.tenantId, state.legalEntityId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (tenantId: string, email: string, password: string) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.message ?? body?.error ?? `Login failed (${res.status})`);
    }
    const result = body as LoginResult;
    localStorage.setItem(STORAGE_KEYS.accessToken, result.accessToken);
    localStorage.setItem(STORAGE_KEYS.sessionToken, result.sessionToken);
    localStorage.setItem(STORAGE_KEYS.tenantId, tenantId);
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(result.user));
    setState({
      accessToken: result.accessToken,
      tenantId,
      user: result.user,
      legalEntityId: state.legalEntityId,
      legalEntityLabel: state.legalEntityLabel,
    });
    // Awaited (not fire-and-forget): the caller navigates away from the
    // login page as soon as this promise resolves, so a gated page could
    // otherwise mount and read an empty permission cache before the
    // background fetch below ever completed.
    await refreshPermissions(result.accessToken, tenantId, state.legalEntityId);
  }, [state.legalEntityId, state.legalEntityLabel]);

  const logout = useCallback(async () => {
    const sessionToken = localStorage.getItem(STORAGE_KEYS.sessionToken);
    const tenantId = localStorage.getItem(STORAGE_KEYS.tenantId);
    if (sessionToken && tenantId) {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, sessionToken }),
        });
      } catch {
        // Best-effort revoke; still clear local state below regardless.
      }
    }
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem(USER_PERMISSIONS_KEY);
    setState({ accessToken: null, tenantId: null, user: null, legalEntityId: null, legalEntityLabel: null });
  }, []);

  const selectLegalEntity = useCallback((legalEntityId: string, legalEntityLabel: string) => {
    localStorage.setItem(STORAGE_KEYS.legalEntityId, legalEntityId);
    localStorage.setItem(STORAGE_KEYS.legalEntityLabel, legalEntityLabel);
    setState((prev) => {
      if (prev.accessToken && prev.tenantId) void refreshPermissions(prev.accessToken, prev.tenantId, legalEntityId);
      return { ...prev, legalEntityId, legalEntityLabel };
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    isAuthenticated: Boolean(state.accessToken && state.tenantId),
    login,
    logout,
    selectLegalEntity,
  }), [state, login, logout, selectLegalEntity]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

// Read-only helpers used by api/client.ts so the fetch layer doesn't need to
// import React context directly.
export function getStoredAccessToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.accessToken);
}
export function getStoredTenantId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.tenantId);
}
