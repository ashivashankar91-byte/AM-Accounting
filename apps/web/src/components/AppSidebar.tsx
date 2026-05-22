import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  CreditCard,
  DollarSign,
  Landmark,
  Users,
  ShoppingCart,
  CalendarCheck,
  BarChart3,
  ListTree,
  Table2,
  CheckSquare,
  FileBarChart,
  Brain,
  Settings,
  Search,
  Bot,
  ChevronRight,
} from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/accounting/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { path: '/accounting/gl', label: 'General Ledger', icon: <BookOpen size={18} /> },
  { path: '/accounting/ap', label: 'Accounts Payable', icon: <CreditCard size={18} /> },
  { path: '/accounting/ar', label: 'Cash Receipts', icon: <DollarSign size={18} /> },
  { path: '/accounting/bank-recon', label: 'Bank Reconciliation', icon: <Landmark size={18} /> },
  { path: '/accounting/payroll', label: 'Payroll', icon: <Users size={18} /> },
  { path: '/accounting/purchase-orders', label: 'Purchase Orders', icon: <ShoppingCart size={18} /> },
  { path: '/accounting/eom', label: 'EOM Close', icon: <CalendarCheck size={18} /> },
  { path: '/accounting/financial-statements', label: 'Financial Statements', icon: <BarChart3 size={18} /> },
  { path: '/coa', label: 'Chart of Accounts', icon: <ListTree size={18} /> },
  { path: '/schedules', label: 'Schedules', icon: <Table2 size={18} /> },
  { path: '/approvals', label: 'Approvals', icon: <CheckSquare size={18} /> },
  { path: '/reports', label: 'Reports', icon: <FileBarChart size={18} /> },
  { path: '/ml', label: 'ML Intelligence', icon: <Brain size={18} /> },
  { path: '/query', label: 'Query Explorer', icon: <Search size={18} /> },
  { path: '/agents', label: 'AI Agents', icon: <Bot size={18} /> },
  { path: '/settings', label: 'Settings', icon: <Settings size={18} /> },
];

export default function AppSidebar() {
  const location = useLocation();

  return (
    <nav
      className="group fixed left-0 top-0 h-screen z-40 flex flex-col
                 bg-slate-900 text-slate-300
                 w-16 hover:w-56 transition-all duration-200 overflow-hidden"
    >
      {/* Logo */}
      <div className="flex items-center h-14 px-4 flex-shrink-0 border-b border-slate-800">
        <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-extrabold tracking-tight">AM</span>
        </div>
        <span className="ml-3 text-white font-bold text-sm whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-75">
          AutoMate
        </span>
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto py-3 space-y-0.5 scrollbar-thin">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              title={item.label}
              className={[
                'flex items-center gap-3 mx-2 px-2 py-2 rounded-lg text-sm font-medium transition-colors no-underline',
                active
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
              ].join(' ')}
            >
              <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {item.icon}
              </span>
              <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-75 overflow-hidden">
                {item.label}
              </span>
              {active && (
                <ChevronRight
                  size={12}
                  className="ml-auto flex-shrink-0 opacity-0 group-hover:opacity-60 transition-opacity duration-150 delay-75"
                />
              )}
            </Link>
          );
        })}
      </div>

      {/* Bottom user avatar */}
      <div className="flex-shrink-0 border-t border-slate-800 h-14 flex items-center px-4">
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
          <span className="text-slate-300 text-xs font-semibold">SA</span>
        </div>
        <span className="ml-3 text-slate-400 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-75 truncate">
          Shiva A.
        </span>
      </div>
    </nav>
  );
}
