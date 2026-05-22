import { useEffect } from 'react';

export interface ActionDefinition {
  label: string;
  onClick: () => void;
  variant: 'primary' | 'secondary' | 'danger';
  shortcut?: string;
  disabled?: boolean;
}

interface ActionBarProps {
  actions: ActionDefinition[];
  hints?: string[];
}

const variantStyles: Record<string, string> = {
  primary: 'bg-brand text-white hover:bg-brand disabled:bg-blue-300',
  secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 disabled:bg-gray-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
};

export default function ActionBar({ actions, hints = [] }: ActionBarProps) {
  // Register keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = actions.find((a) => {
        if (!a.shortcut) return false;
        const [mod, key] = a.shortcut.toLowerCase().split('+');
        const actualKey = mod && !['ctrl', 'shift', 'alt', 'meta'].includes(mod) ? mod : key;
        const hasCtrl = a.shortcut.toLowerCase().includes('ctrl');
        const hasShift = a.shortcut.toLowerCase().includes('shift');
        const hasAlt = a.shortcut.toLowerCase().includes('alt');

        return (
          e.key.toLowerCase() === actualKey &&
          e.ctrlKey === hasCtrl &&
          e.shiftKey === hasShift &&
          e.altKey === hasAlt
        );
      });

      if (action && !action.disabled) {
        e.preventDefault();
        action.onClick();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions]);

  // Sort by variant importance
  const sortedActions = [...actions].sort((a, b) => {
    const variantOrder = { primary: 0, secondary: 1, danger: 2 };
    return variantOrder[a.variant] - variantOrder[b.variant];
  });

  return (
    <div
      className="fixed bottom-0 left-48 right-0 h-12 bg-white border-t border-gray-300 z-10 flex items-center justify-between px-4 gap-4"
      style={{ left: '192px' }}
    >
      {/* Left side: keyboard hints */}
      <div className="flex items-center gap-2 flex-wrap">
        {hints.map((hint, idx) => (
          <kbd
            key={idx}
            className="px-2 py-1 text-xs font-mono bg-gray-100 border border-gray-300 rounded text-gray-700"
          >
            {hint}
          </kbd>
        ))}
      </div>

      {/* Right side: action buttons */}
      <div className="flex items-center gap-2 flex-wrap-reverse">
        {sortedActions.map((action, idx) => (
          <button
            key={idx}
            onClick={action.onClick}
            disabled={action.disabled}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors disabled:cursor-not-allowed ${
              variantStyles[action.variant]
            }`}
            title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
          >
            {action.label}
            {action.shortcut && (
              <span className="ml-2 text-xs opacity-75">
                ({action.shortcut.toUpperCase()})
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
