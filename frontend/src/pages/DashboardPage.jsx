import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import toast from "react-hot-toast";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  ChannelBarChart,
  LineTrendChart,
  MetricCard,
} from "../components/SimpleCharts";

const DEFAULT_LOG_FILTERS = {
  search: "",
  status: "",
  channel: "",
  days: 14,
};

function normalizeStatusTone(status) {
  if (status === "sent") return "bg-emerald-50 text-emerald-700";
  if (status === "failed" || status === "permanently_failed") {
    return "bg-red-50 text-red-700";
  }
  return "bg-gray-100 text-gray-600";
}

export default function DashboardPage() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logsLoading, setLogsLoading] = useState(true);
  const [filters, setFilters] = useState(DEFAULT_LOG_FILTERS);
  const [query, setQuery] = useState(DEFAULT_LOG_FILTERS);
  const [logsPage, setLogsPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [logsPagination, setLogsPagination] = useState(null);
  const [logsSummary, setLogsSummary] = useState(null);
  const [logsTimeline, setLogsTimeline] = useState([]);
  const [logsChannelStats, setLogsChannelStats] = useState([]);

  function applyLogPayload(payload, nextPage) {
    setLogs(payload.data || []);
    setLogsPagination(payload.pagination || null);
    setLogsSummary(payload.summary || null);
    setLogsChannelStats(payload.channel_stats || []);
    setLogsTimeline(
      (payload.timeline || []).map((row) => ({
        label: row.day,
        total: row.total,
        sent: row.sent,
        failed: row.failed,
      })),
    );
    setLogsPage(nextPage);
  }

  async function fetchLogSnapshot(nextPage = logsPage, activeQuery = query) {
    setLogsLoading(true);
    try {
      const payload = await api.getAppNotificationLogs({
        page: nextPage,
        limit: 8,
        ...activeQuery,
      });
      applyLogPayload(payload, nextPage);
    } catch (err) {
      toast.error(err.message || "Failed to load notification logs");
    } finally {
      setLogsLoading(false);
    }
  }

  async function refreshDashboard() {
    setRefreshing(true);
    try {
      const [healthPayload, logsPayload] = await Promise.all([
        api.health(),
        api.getAppNotificationLogs({
          page: logsPage,
          limit: 8,
          ...query,
        }),
      ]);
      setHealth(healthPayload);
      applyLogPayload(logsPayload, logsPage);
    } catch (err) {
      toast.error("Failed to refresh dashboard: " + err.message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      const [healthResult, logsResult] = await Promise.allSettled([
        api.health(),
        api.getAppNotificationLogs({
          page: 1,
          limit: 8,
          ...DEFAULT_LOG_FILTERS,
        }),
      ]);

      if (!mounted) return;

      if (healthResult.status === "fulfilled") {
        setHealth(healthResult.value);
      } else {
        toast.error("Failed to reach BlueMQ: " + healthResult.reason?.message);
      }

      if (logsResult.status === "fulfilled") {
        applyLogPayload(logsResult.value, 1);
      } else {
        toast.error(
          logsResult.reason?.message || "Failed to load notification logs",
        );
      }

      setLoading(false);
      setLogsLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const queueRows = useMemo(
    () =>
      Object.entries(health?.queues || {}).map(([channel, counts]) => {
        const waiting = counts.waiting ?? 0;
        const active = counts.active ?? 0;
        const completed = counts.completed ?? 0;
        const failed = counts.failed ?? 0;
        const delayed = counts.delayed ?? 0;
        return {
          channel,
          waiting,
          active,
          completed,
          failed,
          delayed,
          backlog: waiting + active + delayed,
          processed: completed + failed,
        };
      }),
    [health],
  );

  const queueTotals = useMemo(
    () =>
      queueRows.reduce(
        (acc, row) => ({
          waiting: acc.waiting + row.waiting,
          active: acc.active + row.active,
          completed: acc.completed + row.completed,
          failed: acc.failed + row.failed,
          delayed: acc.delayed + row.delayed,
          backlog: acc.backlog + row.backlog,
          processed: acc.processed + row.processed,
        }),
        {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          backlog: 0,
          processed: 0,
        },
      ),
    [queueRows],
  );

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
          onClick={refreshDashboard}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const providers = health.providers || {};

  function onApplyFilters() {
    const nextQuery = { ...filters };
    setQuery(nextQuery);
    fetchLogSnapshot(1, nextQuery);
  }

  function onResetFilters() {
    setFilters(DEFAULT_LOG_FILTERS);
    setQuery(DEFAULT_LOG_FILTERS);
    fetchLogSnapshot(1, DEFAULT_LOG_FILTERS);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Dashboard</h2>
          <p className="text-sm text-gray-500">
            Live system health with notification log analytics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/notification-logs"
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            Open full logs page
          </Link>
          <button
            onClick={refreshDashboard}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <RefreshCw
              size={14}
              className={refreshing ? "animate-spin text-indigo-500" : ""}
            />
            Refresh
          </button>
        </div>
      </div>

      <div
        className={`flex items-center gap-3 rounded-xl border p-4 ${
          health.status === "ok"
            ? "border-green-200 bg-green-50"
            : "border-red-200 bg-red-50"
        }`}
      >
        {health.status === "ok" ? (
          <CheckCircle className="h-5 w-5 text-green-500" />
        ) : (
          <XCircle className="h-5 w-5 text-red-500" />
        )}
        <span
          className={`text-sm font-medium ${
            health.status === "ok" ? "text-green-700" : "text-red-700"
          }`}
        >
          Service is {health.status === "ok" ? "healthy" : "unhealthy"}
        </span>
        <span className="ml-auto text-xs text-gray-500">
          {new Date(health.timestamp).toLocaleString()}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Queue Backlog"
          value={queueTotals.backlog}
          hint="Waiting + active + delayed jobs"
          tone="indigo"
        />
        <MetricCard
          label="Queue Failures"
          value={queueTotals.failed}
          hint="Failed jobs across all channels"
          tone="red"
        />
        <MetricCard
          label="Logs (selected range)"
          value={logsSummary?.total || 0}
          hint="Filtered app-wide log rows"
          tone="amber"
        />
        <MetricCard
          label="Sent (selected range)"
          value={logsSummary?.sent || 0}
          hint="Successfully delivered attempts"
          tone="emerald"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <LineTrendChart
          data={logsTimeline}
          title="Notification log trend"
          valueKey="total"
          labelKey="label"
        />
        <ChannelBarChart
          data={logsChannelStats}
          title="Logs by channel"
          valueKey="total"
          labelKey="channel"
        />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Filter size={15} />
          Recent log filters
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs text-gray-500">Search</label>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                value={filters.search}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, search: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && onApplyFilters()}
                placeholder="user id, type, title, provider"
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Status</label>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, status: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All</option>
              {["sent", "failed", "permanently_failed", "pending"].map(
                (status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Channel</label>
            <select
              value={filters.channel}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, channel: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All</option>
              {["push", "email", "sms", "whatsapp", "inapp"].map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Last</label>
            <select
              value={filters.days}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  days: Number(e.target.value) || 14,
                }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              {[7, 14, 30, 60, 90].map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={onApplyFilters}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Apply
          </button>
          <button
            onClick={onResetFilters}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Reset
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700">Recent logs</h3>
          <span className="text-xs text-gray-500">
            Page {logsPage}
            {logsPagination?.pages ? ` / ${logsPagination.pages}` : ""}
          </span>
        </div>
        {logsLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-500">
            No logs found for selected filters
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(row.sent_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {row.external_user_id}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.type}</td>
                    <td className="px-4 py-3 capitalize text-gray-700">
                      {row.channel}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {row.provider || "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${normalizeStatusTone(row.status)}`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logsPagination && logsPagination.pages > 1 ? (
          <div className="flex items-center justify-center gap-2 border-t border-gray-100 px-4 py-3">
            <button
              onClick={() => fetchLogSnapshot(logsPage - 1, query)}
              disabled={logsPage <= 1}
              className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-gray-600">
              Page {logsPage} of {logsPagination.pages}
            </span>
            <button
              onClick={() => fetchLogSnapshot(logsPage + 1, query)}
              disabled={logsPage >= logsPagination.pages}
              className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-600 uppercase tracking-wider">
          Providers
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(providers).map(([channel, provider]) => {
            const primary =
              provider && typeof provider === "object"
                ? provider.primary
                : provider;
            const fallback =
              provider && typeof provider === "object"
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
                    {primary || "—"}
                  </span>
                </div>
                {fallback ? (
                  <p className="mt-1.5 text-xs text-gray-400">
                    Fallback:{" "}
                    <span className="font-medium text-gray-500">
                      {fallback}
                    </span>
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-600 uppercase tracking-wider">
          Queue details
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
              {queueRows.map((row) => (
                <tr
                  key={row.channel}
                  className="border-b border-gray-50 last:border-0"
                >
                  <td className="px-4 py-3 font-medium capitalize text-gray-800">
                    {row.channel}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {row.waiting}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        row.active > 0
                          ? "text-indigo-600 font-medium"
                          : "text-gray-600"
                      }
                    >
                      {row.active}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-green-600">
                    {row.completed}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={
                        row.failed > 0
                          ? "text-red-600 font-medium"
                          : "text-gray-600"
                      }
                    >
                      {row.failed}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-amber-600">
                    {row.delayed}
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
