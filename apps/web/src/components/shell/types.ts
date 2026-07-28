import type { LucideIcon } from 'lucide-react';

export interface NavItem { path: string; label: string }
export interface ModuleSection { title: string; items: NavItem[] }
export interface AppModule {
  key: string;
  Icon: LucideIcon;
  label: string;
  defaultPath: string;
  matchPrefixes: string[];
  sections: ModuleSection[];
}
