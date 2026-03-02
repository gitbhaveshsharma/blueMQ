import { useEffect, useState } from 'react';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

export default function DashboardPage() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchHealth() {
    setLoading(true);
    try {
      const data = await api.health();
      setHealth(data);
    } catch (err) {
      toast.error('Failed to reach BlueMQ: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchHealth();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!health) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <XCircle className="mx-auto mb-3 h-10 w-10 text-red-400" />
        <p className="font-medium text-red-700">Cannot reach BlueMQ API</p>
        <p className="mt-1 text-sm text-red-500">
          Ensure the backend is running on port 3001
        </p>
        <button
          onClick={fetchHealth}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const providers = health.providers || {};
  const queues = health.queues || {};
  const waha = health.waha || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-sm text-gray-500">
            System health & queue overview
          </p>
        </div>
        <button
          onClick={fetchHealth}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Status banner */}
      <div
        className={`flex items-center gap-3 rounded-xl border p-4 ${
          health.status === 'ok'
            ? 'border-green-200 bg-green-50'
            : 'border-red-200 bg-red-50'
        }`}
      >
        {health.status === 'ok' ? (
          <CheckCircle className="h-5 w-5 text-green-500" />
        ) : (
          <XCircle className="h-5 w-5 text-red-500" />
        )}
        <span
          className={`text-sm font-medium ${
            health.status === 'ok' ? 'text-green-700' : 'text-red-700'
          }`}
        >
          Service is {health.status === 'ok' ? 'healthy' : 'unhealthy'}
        </span>
        <span className="ml-auto text-xs text-gray-400">
          {new Date(health.timestamp).toLocaleString()}
        </span>
      </div>

      {/* Providers */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-600 uppercase tracking-wider">
          Providers
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(providers).map(([channel, provider]) => {
            const primary =
              provider && typeof provider === 'object'
                ? provider.primary
                : provider;
            const fallback =
              provider && typeof provider === 'object'
                ? provider.fallback
                : null;
            return (
              <div
                key={channel}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 capitalize">
                    {channel}
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                    {primary || '—'}
                  </span>
                </div>
                {fallback && (
                  <p className="mt-1.5 text-xs text-gray-400">
                    Fallback:{' '}
                    <span className="font-medium text-gray-500">{fallback}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* WAHA status */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-600 uppercase tracking-wider">
          WhatsApp (WAHA)
        </h3>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            {waha.reachable ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            )}
            <div>
              <p className="text-sm font-medium text-gray-700">
                {waha.reachable ? 'Connected' : 'Not reachable'}
              </p>
              {waha.error && (
                <p className="text-xs text-gray-400">{waha.error}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Queues */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-600 uppercase tracking-wider">
          Queues
        </h3>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">
                  Channel
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">
                  Waiting
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">
                  Active
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">
                  Completed
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">
                  Failed
                </th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">
                  Delayed
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(queues).map(([channel, counts]) => (
                <tr key={channel} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium capitalize text-gray-800">
                    {channel}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {counts.waiting ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={counts.active > 0 ? 'text-indigo-600 font-medium' : 'text-gray-600'}>
                      {counts.active ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-green-600">
                    {counts.completed ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={counts.failed > 0 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                      {counts.failed ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-amber-600">
                    {counts.delayed ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
