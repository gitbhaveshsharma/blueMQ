import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Send,
  FileText,
  Bell,
  MessageSquare,
  LogOut,
  Menu,
  User,
} from 'lucide-react';
import { createElement, useState } from 'react';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/send', label: 'Send', icon: Send },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { to: '/profile', label: 'Profile', icon: User },
];

export default function DashboardLayout() {
  const { auth, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 w-64 transform bg-gray-900 text-white transition-transform duration-200
          lg:static lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex h-16 items-center gap-2 border-b border-gray-800 px-6">
          <div className="h-8 w-8 rounded-lg bg-indigo-500 flex items-center justify-center font-bold text-sm">
            B
          </div>
          <span className="text-lg font-semibold tracking-tight">BlueMQ</span>
        </div>

        <nav className="mt-4 flex flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              {createElement(icon, { size: 18 })}
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t border-gray-800 p-4">
          <NavLink
            to="/profile"
            onClick={() => setSidebarOpen(false)}
            className="mb-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              {(auth?.appName || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-gray-200">{auth?.appName || 'My App'}</p>
              <p className="truncate text-xs text-gray-400">{auth?.appId || '—'}</p>
            </div>
          </NavLink>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center gap-4 border-b border-gray-200 bg-white px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-lg font-semibold text-gray-800">
            {auth?.appName || 'BlueMQ Dashboard'}
          </h1>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
