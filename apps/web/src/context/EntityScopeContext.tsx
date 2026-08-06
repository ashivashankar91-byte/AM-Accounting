import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { goldenPathApi } from '../api/client';

// AMACC dashboard rebuild — entity scope as a first-class axis.
//
// Build brief, non-negotiable constraint: "Entity is a first-class axis,
// not a filter. The current 'Legal entity: Not selected' state must not be
// reachable... Every query, every API call, every cached view is scoped by
// tenant_id + entity_id (or an explicit consolidated scope)."
//
// AuthContext already tracks legalEntityId/legalEntityLabel and persists
// them (goldenpath.legalEntityId/Label), but nothing forces a value to be
// set, so freshly-logged-in sessions render the muted "Not selected" state
// seen in ContextBar. This provider closes that gap without a disruptive
// rewrite (per "improve, do not break"): as soon as a tenant is known and
// no entity is selected, it loads the tenant's real legal entities and
// auto-selects the first one, while exposing a `setEntity`/`setConsolidated`
// API so any surface (including a real picker in ContextBar) can change the
// scope explicitly. Consolidated scope (Group Dashboard) is an explicit,
// named state — `entityId: null` with `consolidated: true` — never the
// unset/"Not selected" state.

export interface LegalEntityOption {
  id: string;
  entityCode: string;
  legalName: string;
}

export interface EntityScopeContextValue {
  /** Null only while `consolidated` is true or entities are still loading —
   * never a silent "unset" state once loading completes with entities present. */
  entityId: string | null;
  entityLabel: string | null;
  storeId: string | null;
  consolidated: boolean;
  entities: LegalEntityOption[];
  loading: boolean;
  /** True once the tenant's entity list has loaded and it is genuinely
   * empty — the honest "no legal entities configured" case, distinct from
   * "not yet selected". Surfaces must render this explicitly, never $0s. */
  noEntitiesConfigured: boolean;
  error: string | null;
  setEntity: (entityId: string, entityLabel: string) => void;
  setStore: (storeId: string | null) => void;
  setConsolidated: (consolidated: boolean) => void;
}

const EntityScopeContext = createContext<EntityScopeContextValue | undefined>(undefined);

const CONSOLIDATED_KEY = 'goldenpath.entityScope.consolidated';
const STORE_KEY = 'goldenpath.entityScope.storeId';

export function EntityScopeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, tenantId, legalEntityId, legalEntityLabel, selectLegalEntity } = useAuth();
  const [entities, setEntities] = useState<LegalEntityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consolidated, setConsolidatedState] = useState<boolean>(
    () => localStorage.getItem(CONSOLIDATED_KEY) === 'true',
  );
  const [storeId, setStoreIdState] = useState<string | null>(() => localStorage.getItem(STORE_KEY));

  useEffect(() => {
    if (!isAuthenticated || !tenantId) return;
    let cancelled = false;
    setLoading(true);
    goldenPathApi
      .listLegalEntities()
      .then((res) => {
        if (cancelled) return;
        const items: LegalEntityOption[] = (res.items ?? []).map((e: any) => ({
          id: e.id,
          entityCode: e.entityCode,
          legalName: e.legalName,
        }));
        setEntities(items);
        // Close the "Not selected" gap: auto-select the first entity if the
        // session doesn't already have one and the group isn't explicitly
        // scoped to "consolidated". A real user pick (via setEntity) always
        // overrides this default on any subsequent load.
        if (!legalEntityId && !consolidated && items.length > 0) {
          const first = items[0];
          selectLegalEntity(first.id, `${first.entityCode} — ${first.legalName}`);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? 'Failed to load legal entities');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, tenantId]);

  const setEntity = (id: string, label: string) => {
    setConsolidatedState(false);
    localStorage.setItem(CONSOLIDATED_KEY, 'false');
    selectLegalEntity(id, label);
  };

  const setStore = (id: string | null) => {
    setStoreIdState(id);
    if (id) localStorage.setItem(STORE_KEY, id);
    else localStorage.removeItem(STORE_KEY);
  };

  const setConsolidated = (value: boolean) => {
    setConsolidatedState(value);
    localStorage.setItem(CONSOLIDATED_KEY, String(value));
  };

  const value = useMemo<EntityScopeContextValue>(
    () => ({
      entityId: consolidated ? null : legalEntityId,
      entityLabel: consolidated ? 'Consolidated (all entities)' : legalEntityLabel,
      storeId: consolidated ? null : storeId,
      consolidated,
      entities,
      loading,
      noEntitiesConfigured: loaded && entities.length === 0,
      error,
      setEntity,
      setStore,
      setConsolidated,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consolidated, legalEntityId, legalEntityLabel, storeId, entities, loading, loaded, error],
  );

  return <EntityScopeContext.Provider value={value}>{children}</EntityScopeContext.Provider>;
}

export function useEntityScope(): EntityScopeContextValue {
  const ctx = useContext(EntityScopeContext);
  if (!ctx) throw new Error('useEntityScope must be used within an EntityScopeProvider');
  return ctx;
}
