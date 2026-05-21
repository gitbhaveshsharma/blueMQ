import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import toast from "react-hot-toast";
import {
  Clock,
  RefreshCw,
  Plus,
  Play,
  Pause,
  Pencil,
  Trash2,
  FileText,
  X,
  ChevronLeft,
  ChevronRight,
  Zap,
  AlertCircle,
  CheckCircle,
  XCircle,
} from "lucide-react";

// ─── Constants ──────────────────────────────────────────────

const STATUS_FILTERS = ["all", "active", "paused", "completed", "failed"];
const TYPE_FILTERS = ["all", "one_time", "recurring"];
const FREQUENCIES = ["daily", "weekly", "monthly", "custom_cron"];
const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// ─── Helpers ────────────────────────────────────────────────

function statusBadge(status) {
  const map = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    paused: "bg-amber-50 text-amber-700 border-amber-200",
    completed: "bg-gray-100 text-gray-600 border-gray-200",
    failed: "bg-red-50 text-red-700 border-red-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    partial: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return map[status] || "bg-gray-100 text-gray-600 border-gray-200";
}

function typeBadge(type) {
  return type === "one_time"
    ? "bg-sky-50 text-sky-700 border-sky-200"
    : "bg-violet-50 text-violet-700 border-violet-200";
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date - now;
  const absDiff = Math.abs(diffMs);
  const isPast = diffMs < 0;

  if (absDiff < 60000) return isPast ? "just now" : "in a moment";
  if (absDiff < 3600000) {
    const mins = Math.floor(absDiff / 60000);
    return isPast ? `${mins}m ago` : `in ${mins}m`;
  }
  if (absDiff < 86400000) {
    const hrs = Math.floor(absDiff / 3600000);
    return isPast ? `${hrs}h ago` : `in ${hrs}h`;
  }
  const days = Math.floor(absDiff / 86400000);
  return isPast ? `${days}d ago` : `in ${days}d`;
}

function formatScheduleDesc(s) {
  if (s.type === "one_time") {
    return s.run_at ? new Date(s.run_at).toLocaleString() : "—";
  }
  const time = s.time_of_day ? s.time_of_day.substring(0, 5) : "";
  switch (s.frequency) {
    case "daily":
      return `Daily at ${time}`;
    case "weekly":
      return `Every ${DAYS_OF_WEEK[s.day_of_week] || "?"} at ${time}`;
    case "monthly":
      return `${ordinal(s.day_of_month)} of every month at ${time}`;
    case "custom_cron":
      return `Cron: ${s.cron_expression}`;
    default:
      return s.frequency || "—";
  }
}

function ordinal(n) {
  if (!n) return "?";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ─── Sub-Components ─────────────────────────────────────────

function StatusIcon({ status }) {
  if (status === "success")
    return <CheckCircle size={14} className="text-emerald-500" />;
  if (status === "failed")
    return <XCircle size={14} className="text-red-500" />;
  if (status === "partial")
    return <AlertCircle size={14} className="text-amber-500" />;
  return null;
}

// ─── Logs Modal ─────────────────────────────────────────────

function LogsModal({ isOpen, onClose, schedule }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);

  const fetchLogs = useCallback(async () => {
    if (!schedule) return;
    setLoading(true);
    try {
      const data = await api.getScheduleLogs(schedule.id, { page, limit: 10 });
      setLogs(data.data || []);
      setPagination(data.pagination || null);
    } catch (err) {
      toast.error("Failed to load logs: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [schedule, page]);

  useEffect(() => {
    if (isOpen && schedule) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(1);
    }
  }, [isOpen, schedule]);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl animate-[fadeIn_0.2s_ease-in]">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Execution Logs</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {schedule?.template_key}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">
              No execution logs yet
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <th className="pb-3 pr-4">Triggered At</th>
                      <th className="pb-3 pr-4">By</th>
                      <th className="pb-3 pr-4">Status</th>
                      <th className="pb-3 pr-4">Recipients</th>
                      <th className="pb-3 pr-4">Success</th>
                      <th className="pb-3 pr-4">Failed</th>
                      <th className="pb-3">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="py-3 pr-4 text-gray-700 whitespace-nowrap">
                          {new Date(log.triggered_at).toLocaleString()}
                        </td>
                        <td className="py-3 pr-4 text-gray-500">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              log.triggered_by === "manual"
                                ? "bg-violet-50 text-violet-600"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {log.triggered_by || "scheduler"}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadge(log.status)}`}
                          >
                            <StatusIcon status={log.status} />
                            {log.status}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-gray-700">
                          {log.total_recipients ?? 0}
                        </td>
                        <td className="py-3 pr-4 text-emerald-600">
                          {log.success_count ?? 0}
                        </td>
                        <td className="py-3 pr-4 text-red-600">
                          {log.fail_count ?? 0}
                        </td>
                        <td className="py-3 text-gray-500 max-w-[200px] truncate">
                          {log.error_message || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination && pagination.pages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <span className="text-xs text-gray-400">
                    Page {pagination.page} of {pagination.pages} (
                    {pagination.total} total)
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      onClick={() =>
                        setPage((p) => Math.min(pagination.pages, p + 1))
                      }
                      disabled={page >= pagination.pages}
                      className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-gray-50 disabled:opacity-30 transition-colors"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function SchedulesPage() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [logsSchedule, setLogsSchedule] = useState(null);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (typeFilter !== "all") params.type = typeFilter;
      const data = await api.getSchedules(params);
      setSchedules(data.data || []);
    } catch (err) {
      toast.error("Failed to load schedules: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSchedules();
  }, [fetchSchedules]);

  async function handleToggleStatus(schedule) {
    const newStatus = schedule.status === "active" ? "paused" : "active";
    try {
      await api.updateSchedule(schedule.id, { status: newStatus });
      toast.success(
        newStatus === "active" ? "Schedule resumed" : "Schedule paused",
      );
      fetchSchedules();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleDelete(schedule) {
    if (!confirm(`Delete schedule "${schedule.template_key}"?`)) return;
    try {
      await api.deleteSchedule(schedule.id);
      toast.success("Schedule deleted");
      fetchSchedules();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleTrigger(schedule) {
    try {
      const result = await api.triggerSchedule(schedule.id);
      toast.success(
        `Triggered: ${result.data?.success_count || 0}/${result.data?.total_recipients || 0} sent`,
      );
      fetchSchedules();
    } catch (err) {
      toast.error("Trigger failed: " + err.message);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Clock size={22} className="text-indigo-500" />
            Scheduled Notifications
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage one-time and recurring notification schedules
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchSchedules}
            className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => {
              navigate("/schedules/new");
            }}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-all"
          >
            <Plus size={16} />
            Create Schedule
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Status pills */}
        <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                statusFilter === s
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
        >
          {TYPE_FILTERS.map((t) => (
            <option key={t} value={t}>
              {t === "all"
                ? "All Types"
                : t === "one_time"
                  ? "One-Time"
                  : "Recurring"}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 py-20">
          <Clock size={48} className="text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-1">
            No schedules found
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            Create your first scheduled notification to get started
          </p>
          <button
            onClick={() => {
              navigate("/schedules/new");
            }}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-all"
          >
            <Plus size={16} />
            Create Schedule
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3">Timezone</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Run</th>
                  <th className="px-4 py-3">Next Run</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-4 py-3.5">
                      <span className="font-medium text-gray-900">
                        {s.template_key}
                      </span>
                      {s.created_by && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          by {s.created_by}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${typeBadge(s.type)}`}
                      >
                        {s.type === "one_time" ? "One-time" : "Recurring"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-600 whitespace-nowrap">
                      {formatScheduleDesc(s)}
                    </td>
                    <td className="px-4 py-3.5 text-gray-500 text-xs">
                      {s.timezone || "UTC"}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadge(s.status)}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {s.last_run_at ? (
                        <div className="flex items-center gap-1.5">
                          <StatusIcon status={s.last_run_status} />
                          <span className="text-gray-600 text-xs">
                            {formatRelativeTime(s.last_run_at)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-600 whitespace-nowrap">
                      {s.status === "completed" ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        formatRelativeTime(s.next_run_at)
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        {/* Pause / Resume */}
                        {(s.status === "active" || s.status === "paused") && (
                          <button
                            onClick={() => handleToggleStatus(s)}
                            title={s.status === "active" ? "Pause" : "Resume"}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                          >
                            {s.status === "active" ? (
                              <Pause size={14} />
                            ) : (
                              <Play size={14} />
                            )}
                          </button>
                        )}

                        {/* Trigger Now */}
                        <button
                          onClick={() => handleTrigger(s)}
                          title="Trigger Now"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                        >
                          <Zap size={14} />
                        </button>

                        {/* Edit */}
                        <button
                          onClick={() => {
                            navigate(`/schedules/${s.id}/edit`);
                          }}
                          title="Edit"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>

                        {/* View Logs */}
                        <button
                          onClick={() => setLogsSchedule(s)}
                          title="View Logs"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <FileText size={14} />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(s)}
                          title="Delete"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      <LogsModal
        isOpen={!!logsSchedule}
        onClose={() => setLogsSchedule(null)}
        schedule={logsSchedule}
      />
    </div>
  );
}
