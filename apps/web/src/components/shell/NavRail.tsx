import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AppModule } from './types';

// Golden R0 UI convergence — Phase 1: single collapsible Accounting nav rail,
// replacing the previous two-panel (fixed 64px icon rail + fixed 192px
// sub-nav) layout. Matches Section 03 shell anatomy: "232px expanded / 56px
// collapsed. One section open at a time; selected leaf marked with a 3px
// white bar and solid tint." (design doc lines 509, 609). Gradient and
// collapse-behavior are the approved tokens (line 512: linear-gradient(170deg,
// #4E2578, #331452)); module/section content itself is unchanged from the
// existing MODULES taxonomy in App.tsx — only the container and interaction
// pattern are being converged onto the approved shell.
//
// Known remaining gap (tracked, not fixed this phase): the design's collapsed
// state additionally specifies a hover flyout that reveals labels/sub-items
// without expanding the rail. This build shows icon tooltips only in the
// collapsed state; the flyout is deferred.

const EXPANDED_WIDTH = 232;
const COLLAPSED_WIDTH = 56;

interface NavRailProps {
  modules: AppModule[];
  activeKey: string;
  pathname: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectModule: (key: string) => void;
}

export function NavRail({ modules, activeKey, pathname, collapsed, onToggleCollapsed, onSelectModule }: NavRailProps) {
  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  return (
    <nav
      className="fixed left-0 top-0 h-screen flex flex-col z-50 transition-[width] duration-150 ease-out"
      style={{ width, background: 'linear-gradient(170deg,#4E2578,#331452)' }}
    >
      {/* Logo row — 52px, matches Section 03 shell anatomy */}
      <div className="flex items-center gap-2.5 h-[52px] px-3.5 border-b border-white/10 flex-shrink-0 overflow-hidden">
        <span className="w-[18px] h-[18px] bg-white rounded-[3px] rotate-45 flex-shrink-0" />
        {!collapsed && (
          <span className="text-white text-[14px] font-semibold tracking-wide whitespace-nowrap">AutoMate</span>
        )}
      </div>

      {/* Module list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-3.5 scrollbar-thin">
        {!collapsed && (
          <div className="px-3.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/45 whitespace-nowrap">
            Accounting
          </div>
        )}
        {modules.map((mod) => {
          const active = activeKey === mod.key;
          return (
            <div key={mod.key}>
              <button
                type="button"
                title={collapsed ? mod.label : undefined}
                onClick={() => onSelectModule(mod.key)}
                className="relative w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] transition-colors"
                style={{
                  color: active ? '#fff' : 'rgba(255,255,255,.82)',
                  fontWeight: active ? 600 : 400,
                  background: active ? 'rgba(255,255,255,.08)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,.09)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-white" />}
                <mod.Icon size={16} className="flex-shrink-0" />
                {!collapsed && <span className="truncate">{mod.label}</span>}
              </button>

              {/* Nested sections — only the active module expands, one at a time */}
              {active && !collapsed && (
                <div className="pb-1">
                  {mod.sections.map((section) => (
                    <div key={section.title} className="mb-0.5">
                      <p className="px-3.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40 select-none whitespace-nowrap">
                        {section.title}
                      </p>
                      {section.items.map((item) => {
                        const itemActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path + '/'));
                        return (
                          <Link
                            key={item.path}
                            to={item.path}
                            className="flex items-center gap-2 py-1.5 pl-9 pr-3.5 text-[13px] no-underline transition-colors"
                            style={{
                              color: itemActive ? '#fff' : 'rgba(255,255,255,.72)',
                              fontWeight: itemActive ? 600 : 400,
                              background: itemActive ? 'rgba(255,255,255,.16)' : 'transparent',
                              borderLeft: itemActive ? '3px solid #fff' : '3px solid transparent',
                              marginLeft: -3,
                            }}
                          >
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        className="flex items-center gap-2 px-3.5 py-3 border-t border-white/10 text-[12px] text-white/60 hover:text-white transition-colors flex-shrink-0"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </nav>
  );
}

export { EXPANDED_WIDTH, COLLAPSED_WIDTH };
