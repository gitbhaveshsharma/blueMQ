import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  BarChart3,
} from "lucide-react";
import { api } from "../services/api";
import {
  ChannelBarChart,
  LineTrendChart,
  MetricCard,
} from "../components/SimpleCharts";

const DEFAULT_FILTERS = {
  search: "",
  channel: "",
  status: "",
  provider: "",
  from: "",
  to: "",
};

function toSearchTokens(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
}

function matchesTokens(haystack, tokens) {
  if (tokens.length === 0) return true;
  const normalized = String(haystack || "").toLowerCase();
  return tokens.every((token) => normalized.includes(token));
}

function buildLogSearchText(row) {
  return [
    row.notification_id,
    row.external_user_id,
    row.type,
    row.title,
    row.message,
    row.channel,
    row.provider,
    row.status,
    row.error,
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeStatusTone(status) {
  if (status === "sent") return "bg-emerald-50 text-emerald-700";
  if (status === "failed" || status === "permanently_failed") {
    return "bg-red-50 text-red-700";
  }
  return "bg-gray-100 text-gray-600";
}

export default function NotificationLogsPage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [query, setQuery] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary] = useState(null);
  const [channelStats, setChannelStats] = useState([]);
  const [timeline, setTimeline] = useState([]);

  const providerOptions = useMemo(
    () =>
      [
        ...new Set((data || []).map((row) => row.provider).filter(Boolean)),
      ].sort(),
    [data],
  );

  const fetchLogs = useCallback(
    async (nextPage = page, activeQuery = query) => {
      setLoading(true);
      try {
        const res = await api.getAppNotificationLogs({
          page: nextPage,
          limit: 20,
          ...activeQuery,
        });

        setData(res.data || []);
        setPagination(res.pagination || null);
        setSummary(res.summary || null);
        setChannelStats(res.channel_stats || []);
        setTimeline(
          (res.timeline || []).map((item) => ({
            label: item.day,
            total: item.total,
            sent: item.sent,
            failed: item.failed,
          })),
        );
        setPage(nextPage);
      } catch (err) {
        toast.error(err.message || "Failed to load notification logs");
      } finally {
        setLoading(false);
      }
    },
    [page, query],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs(1, query);
  }, []);

  useEffect(() => {
    if (filters.search === query.search) return;
    const handle = setTimeout(() => {
      const nextQuery = { ...query, search: filters.search };
      setQuery(nextQuery);
      fetchLogs(1, nextQuery);
    }, 350);

    return () => clearTimeout(handle);
  }, [filters.search, query, fetchLogs]);

  function onApplyFilters() {
    setQuery(filters);
    fetchLogs(1, filters);
  }

  function onResetFilters() {
    setFilters(DEFAULT_FILTERS);
    setQuery(DEFAULT_FILTERS);
    fetchLogs(1, DEFAULT_FILTERS);
  }

  const searchTokens = useMemo(
    () => toSearchTokens(filters.search),
    [filters.search],
  );
  const visibleData = useMemo(() => {
    if (searchTokens.length === 0) return data;
    return data.filter((row) =>
      matchesTokens(buildLogSearchText(row), searchTokens),
    );
  }, [data, searchTokens]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Notification Logs</h2>
          <p className="text-sm text-gray-500">
            Analyze app-level delivery logs with filters, trends, and pagination
          </p>
        </div>
        <button
          onClick={() => fetchLogs(page, query)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Filter size={15} />
          Filters
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-6">
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
                placeholder="user id, title, type, provider"
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
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
            <label className="mb-1 block text-xs text-gray-500">Provider</label>
            <select
              value={filters.provider}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, provider: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All</option>
              {providerOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, from: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, to: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Logs"
          value={summary?.total || 0}
          tone="indigo"
        />
        <MetricCard label="Sent" value={summary?.sent || 0} tone="emerald" />
        <MetricCard
          label="Failures"
          value={(summary?.failed || 0) + (summary?.permanently_failed || 0)}
          tone="red"
        />
        <MetricCard
          label="Notifications"
          value={summary?.notifications || 0}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <LineTrendChart
          data={timeline}
          title="Notification logs trend"
          valueKey="total"
          labelKey="label"
        />
        <ChannelBarChart
          data={channelStats}
          title="Logs by channel"
          valueKey="total"
          labelKey="channel"
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-700">
          <BarChart3 size={15} />
          Log entries
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
          </div>
        ) : data.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-500">
            No logs found for selected filters
          </div>
        ) : visibleData.length === 0 ? (
          <div className="py-14 text-center text-sm text-gray-500">
            No logs match your search
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
                  <th className="px-4 py-3">Attempt</th>
                  <th className="px-4 py-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {visibleData.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-gray-100 align-top"
                  >
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
                    <td className="px-4 py-3 text-gray-600">
                      {row.attempt_number}
                    </td>
                    <td className="px-4 py-3 text-xs text-red-600">
                      {row.error ? row.error : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination && pagination.pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => fetchLogs(page - 1, query)}
            disabled={page <= 1}
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {pagination.pages}
          </span>
          <button
            onClick={() => fetchLogs(page + 1, query)}
            disabled={page >= pagination.pages}
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
