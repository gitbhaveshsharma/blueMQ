import { createElement, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Copy, Check, RefreshCw, User, Mail, Hash, Key, Calendar } from 'lucide-react';

function Field({ label, icon, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
        {createElement(icon, { size: 12 })}
        {label}
      </p>
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800">
        {children}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { auth, logout } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function fetchProfile() {
    setLoading(true);
    try {
      const data = await api.getAppProfile();
      setProfile(data);
    } catch (err) {
      toast.error('Failed to load profile: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProfile();
  }, []);

  function handleCopyKey() {
    navigator.clipboard.writeText(auth?.apiKey || '');
    setCopiedKey(true);
    toast.success('API key copied');
    setTimeout(() => setCopiedKey(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  const createdAt = profile?.created_at
    ? new Date(profile.created_at).toLocaleString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">App Profile</h2>
        <p className="text-sm text-gray-500">Your app account information</p>
      </div>

      {/* Avatar card */}
      <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white">
          {(profile?.name || auth?.appName || 'A').charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-lg font-semibold text-gray-900">
            {profile?.name || auth?.appName || '—'}
          </p>
          <p className="text-sm text-gray-500">{profile?.email || auth?.email || '—'}</p>
        </div>
        <button
          onClick={fetchProfile}
          className="ml-auto rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Info fields */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
        <Field label="App Name" icon={User}>
          <span className="font-medium">{profile?.name || '—'}</span>
        </Field>

        <Field label="App ID" icon={Hash}>
          <span className="font-mono">{profile?.app_id || '—'}</span>
        </Field>

        <Field label="Email" icon={Mail}>
          {profile?.email || '—'}
        </Field>

        <Field label="Registered" icon={Calendar}>
          {createdAt}
        </Field>

        {/* API Key — never shown by default */}
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <Key size={12} />
            API Key
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-mono text-gray-800 overflow-hidden">
              {showKey
                ? auth?.apiKey || '—'
                : '•'.repeat(Math.min(auth?.apiKey?.length ?? 32, 48))}
            </div>
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="shrink-0 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              onClick={handleCopyKey}
              className="shrink-0 rounded-lg border border-gray-200 p-2.5 text-gray-500 hover:bg-gray-50 transition-colors"
              title="Copy API key"
            >
              {copiedKey ? (
                <Check size={16} className="text-green-500" />
              ) : (
                <Copy size={16} />
              )}
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Use this key as <code className="text-xs">x-api-key</code> header in all API requests.
          </p>
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold text-red-600">Sign Out</h3>
        <p className="mb-4 text-xs text-gray-500">
          This clears your session from this browser. Your app and API key remain active.
        </p>
        <button
          onClick={logout}
          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
