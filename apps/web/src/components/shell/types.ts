import type { LucideIcon } from 'lucide-react';

// `permission` is optional and additive — items without it render exactly as
// before. When set, NavRail hides the item unless that key is present in the
// same `userPermissions` localStorage array every page's client-side RBAC
// check already reads (server-side enforcement remains the sole source of
// truth; this is nav-visibility only).
export interface NavItem { path: string; label: string; permission?: string }
export interface ModuleSection { title: string; items: NavItem[] }
export interface AppModule {
  key: string;
  Icon: LucideIcon;
  label: string;
  defaultPath: string;
  matchPrefixes: string[];
  sections: ModuleSection[];
}
