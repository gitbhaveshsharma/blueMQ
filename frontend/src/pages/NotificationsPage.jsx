import { useState } from 'react';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  Search,
  Bell,
  CheckCheck,
  Eye,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ScrollText,
  X,
} from 'lucide-react';

export default function NotificationsPage() {
  const [userId, setUserId] = useState('');
  const [notifications, setNotifications] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [logsModal, setLogsModal] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  async function fetchNotifications(p = page) {
    if (!userId.trim()) {
      toast.error('Enter a user ID');
      return;
    }
    setLoading(true);
    try {
      const data = await api.getNotifications(userId.trim(), {
        page: p,
        limit: 20,
      });
      setNotifications(data.data || []);
      setPagination(data.pagination || null);
      setUnreadCount(data.unread_count ?? 0);
      setPage(p);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkRead(id) {
    try {
      await api.markAsRead(id);
      toast.success('Marked as read');
      fetchNotifications(page);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleMarkAllRead() {
    if (!userId.trim()) return;
    try {
      await api.markAllRead(userId.trim());
      toast.success('All marked as read');
      fetchNotifications(page);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function openLogs(notifId) {
    setLogsModal(notifId);
    setLogsLoading(true);
    try {
      const data = await api.getDeliveryLogs(notifId);
      setLogs(data.data || []);
    } catch (err) {
      toast.error(err.message);
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Notifications</h2>
        <p className="text-sm text-gray-500">
          View in-app notifications for any user
        </p>
      </div>

      {/* Search bar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchNotifications(1)}
            placeholder="Enter user ID..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <button
          onClick={() => fetchNotifications(1)}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
          Search
        </button>
      </div>

      {/* Stats bar */}
      {pagination && (
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>
              Total: <strong>{pagination.total}</strong>
            </span>
            <span>
              Unread:{' '}
              <strong className="text-indigo-600">{unreadCount}</strong>
            </span>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
          )}
        </div>
      )}

      {/* Notification list */}
      {notifications.length === 0 && pagination && (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <Bell className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="font-medium text-gray-500">No notifications</p>
        </div>
      )}

      {notifications.length > 0 && (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${
                n.is_read
                  ? 'border-gray-200'
                  : 'border-indigo-200 bg-indigo-50/30'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!n.is_read && (
                      <span className="h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
                    )}
                    <h4 className="text-sm font-semibold text-gray-800 truncate">
                      {n.title || n.type}
                    </h4>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      {n.type}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-600 line-clamp-2">
                    {n.message}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                    <span>{new Date(n.created_at).toLocaleString()}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        n.status === 'sent'
                          ? 'bg-green-50 text-green-600'
                          : n.status === 'failed'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {n.status}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 gap-1">
                  {!n.is_read && (
                    <button
                      onClick={() => handleMarkRead(n.id)}
                      className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-green-600 transition-colors"
                      title="Mark as read"
                    >
                      <Eye size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => openLogs(n.id)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 transition-colors"
                    title="View delivery logs"
                  >
                    <ScrollText size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => fetchNotifications(page - 1)}
            disabled={page <= 1}
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {pagination.pages}
          </span>
          <button
            onClick={() => fetchNotifications(page + 1)}
            disabled={page >= pagination.pages}
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Logs modal */}
      {logsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[80vh] flex flex-col">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Delivery Logs
              </h3>
              <button
                onClick={() => setLogsModal(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            {logsLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
              </div>
            ) : logs.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">
                No delivery logs found
              </p>
            ) : (
              <div className="overflow-y-auto space-y-3">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-gray-100 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize text-gray-700">
                        {log.channel}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          log.status === 'sent'
                            ? 'bg-green-50 text-green-600'
                            : log.status === 'failed'
                              ? 'bg-red-50 text-red-600'
                              : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>
                    {log.provider_message_id && (
                      <p className="mt-1 font-mono text-xs text-gray-400 truncate">
                        ID: {log.provider_message_id}
                      </p>
                    )}
                    {log.error_message && (
                      <p className="mt-1 text-xs text-red-500">
                        {log.error_message}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
                      {new Date(log.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
