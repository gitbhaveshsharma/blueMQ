import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  FileText,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  CalendarDays,
  X,
  CloudDownload,
  Settings,
  Link2,
  ArrowRight,
  Save,
} from "lucide-react";
import { api } from "../services/api";
import {
  TEMPLATE_CHANNELS,
  getTemplateChannelConfig,
} from "../config/templateChannels";

const ITEMS_PER_PAGE = 8;

// ─── Date-range preset config ────────────────────────────────────────────────

const DATE_PRESETS = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },   // default "Recent"
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Custom", days: null },
];

const DEFAULT_PRESET = DATE_PRESETS[1]; // "Last 7 days"

/** Format a Date to YYYY-MM-DD for <input type="date"> */
function toDateInputValue(date) {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

/** Returns today's date as YYYY-MM-DD string */
function todayStr() {
  return toDateInputValue(new Date());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRuleLabel(template) {
  if (template.source === "meta") {
    return `${template.language || "—"} · ${template.category || "Meta"}`;
  }
  if (template.condition_key && template.condition_value) {
    return `${template.condition_key} = ${template.condition_value}`;
  }
  return "Default";
}

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

function buildTemplateSearchText(template) {
  const channelConfig = getTemplateChannelConfig(template.channel);
  return [
    template.type,
    template.title,
    getRuleLabel(template),
    template.channel,
    channelConfig.label,
  ]
    .filter(Boolean)
    .join(" ");
}

// ─── DateRangeFilter component ────────────────────────────────────────────────

/**
 * Self-contained date-range filter.
 * Props:
 *   value: { preset: { label, days }, from: string, to: string }
 *   onChange: (newValue) => void
 */
function DateRangeFilter({ value, onChange }) {
  const isCustom = value.preset.days === null;

  function selectPreset(preset) {
    if (preset.days !== null) {
      // Built-in range — clear custom dates
      onChange({ preset, from: "", to: "" });
    } else {
      // Custom — keep current custom dates if any
      onChange({ preset, from: value.from, to: value.to });
    }
  }

  function handleCustomFrom(e) {
    onChange({ ...value, from: e.target.value });
  }

  function handleCustomTo(e) {
    onChange({ ...value, to: e.target.value });
  }

  function clearFilter() {
    onChange({ preset: DEFAULT_PRESET, from: "", to: "" });
  }

  const hasActiveFilter =
    value.preset.days !== DEFAULT_PRESET.days ||
    (isCustom && (value.from || value.to));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Preset pills */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
        <CalendarDays size={13} className="ml-1 text-gray-400 shrink-0" />
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => selectPreset(preset)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              value.preset.label === preset.label
                ? "bg-white text-indigo-600 shadow-sm ring-1 ring-indigo-200"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Custom date inputs — shown only when Custom is selected */}
      {isCustom && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={value.from}
            max={value.to || todayStr()}
            onChange={handleCustomFrom}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={value.to}
            min={value.from || undefined}
            max={todayStr()}
            onChange={handleCustomTo}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
      )}

      {/* Clear button — shown only when filter differs from default */}
      {hasActiveFilter && (
        <button
          onClick={clearFilter}
          className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-500 shadow-sm hover:bg-gray-50"
          title="Reset to default (Last 7 days)"
        >
          <X size={11} />
          Reset
        </button>
      )}
    </div>
  );
}

// ─── ActionsMenu ──────────────────────────────────────────────────────────────

function ActionsMenu({ onEdit, onDelete, onSettings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        title="Actions"
      >
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-36 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          <button
            onClick={() => {
              onEdit();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Pencil size={13} className="text-gray-400" />
            Edit
          </button>
          {onSettings ? (
            <button
              onClick={() => {
                onSettings();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Settings size={13} className="text-gray-400" />
              Alias settings
            </button>
          ) : null}
          {onDelete ? (
          <button
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={13} className="text-red-400" />
            Delete
          </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── WhatsApp Template Alias Sheet ───────────────────────────────────────────

function TemplateAliasSheet({
  entityId,
  channel,
  initialType,
  aliases,
  channelTemplates,
  onSave,
  onDelete,
  onClose,
}) {
  const channelAliases = useMemo(
    () => aliases.filter((alias) => alias.channel === channel),
    [aliases, channel],
  );
  const existing = channelAliases.find(
    (alias) => alias.notification_type === initialType,
  );
  const [editingId, setEditingId] = useState(existing?.id || null);
  const [notificationType, setNotificationType] = useState(
    existing?.notification_type || initialType || "",
  );
  const [resolvesTo, setResolvesTo] = useState(existing?.resolves_to || "");
  const [busy, setBusy] = useState(false);

  const templateNames = useMemo(
    () =>
      [
        ...new Set(
          channelTemplates.map(
            (template) => template.name || template.type,
          ),
        ),
      ]
        .filter(Boolean)
        .sort(),
    [channelTemplates],
  );

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function resetForm(type = "") {
    setEditingId(null);
    setNotificationType(type);
    setResolvesTo("");
  }

  function editAlias(alias) {
    setEditingId(alias.id);
    setNotificationType(alias.notification_type);
    setResolvesTo(alias.resolves_to);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave({
        id: editingId,
        channel,
        entity_id: entityId,
        notification_type: notificationType.trim(),
        resolves_to: resolvesTo,
      });
      resetForm();
    } finally {
      setBusy(false);
    }
  }

  async function remove(alias) {
    if (!confirm(`Remove alias "${alias.notification_type}"?`)) return;
    setBusy(true);
    try {
      await onDelete(alias);
      if (editingId === alias.id) resetForm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close template alias settings"
        onClick={onClose}
        className="absolute inset-0 bg-gray-950/30 backdrop-blur-[1px]"
      />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 text-green-700">
                <Link2 size={16} />
              </span>
              <h3 className="text-lg font-semibold text-gray-900">
                Template Aliases
              </h3>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Route an incoming notification type to another{" "}
              <span className="font-medium">{channel}</span> template
              {channel === "whatsapp" ? (
                <>
                  {" "}for <span className="font-medium">{entityId}</span>
                </>
              ) : null}
              .
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <form
            onSubmit={submit}
            className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4"
          >
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Notification type
              </label>
              <input
                required
                value={notificationType}
                onChange={(event) => setNotificationType(event.target.value)}
                placeholder="coaching_profile_live"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <p className="mt-1 text-xs text-gray-400">
                The key received by BlueMQ from your application.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Resolve to {channel} template
              </label>
              <select
                required
                value={resolvesTo}
                onChange={(event) => setResolvesTo(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Select a synced template</option>
                {templateNames.map((name) => (
                  <option
                    key={name}
                    value={name}
                    disabled={name === notificationType.trim()}
                  >
                    {name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                The target must already exist for this channel.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              {editingId ? (
                <button
                  type="button"
                  onClick={() => resetForm(initialType)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  Cancel edit
                </button>
              ) : null}
              <button
                type="submit"
                disabled={busy || !notificationType.trim() || !resolvesTo}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {editingId ? "Update alias" : "Save alias"}
              </button>
            </div>
          </form>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">
                Configured aliases
              </h4>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {channelAliases.length}
              </span>
            </div>

            {channelAliases.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-gray-200 px-4 py-8 text-center">
                <Link2 size={24} className="mx-auto text-gray-300" />
                <p className="mt-2 text-sm text-gray-500">
                  No aliases configured for this channel.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {channelAliases.map((alias) => (
                  <div
                    key={alias.id}
                    className="flex items-center gap-3 rounded-xl border border-gray-200 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs">
                        <code className="truncate font-medium text-gray-800">
                          {alias.notification_type}
                        </code>
                        <ArrowRight
                          size={12}
                          className="shrink-0 text-gray-400"
                        />
                        <code className="truncate font-medium text-green-700">
                          {alias.resolves_to}
                        </code>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => editAlias(alias)}
                      disabled={busy}
                      className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-indigo-600"
                      title="Edit alias"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(alias)}
                      disabled={busy}
                      className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete alias"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

// ─── TemplateCard (mobile) ────────────────────────────────────────────────────

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onSettings,
  aliasTarget,
}) {
  const channelConfig = getTemplateChannelConfig(template.channel);

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-gray-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium text-gray-700 break-all">
              {template.type}
            </span>
            {aliasTarget ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                <Link2 size={10} />
                uses {aliasTarget}
              </span>
            ) : null}
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                channelConfig.badgeClass || "bg-gray-50 text-gray-700"
              }`}
            >
              {channelConfig.label || template.channel}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                template.is_active !== false
                  ? "bg-green-50 text-green-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {template.is_active !== false ? "Active" : "Inactive"}
              {template.status && template.source === "meta"
                ? ` · ${template.status}`
                : ""}
            </span>
          </div>
          <p className="text-xs text-gray-500">{getRuleLabel(template)}</p>
          <p className="text-sm font-medium text-gray-900 truncate">
            {template.title || "Untitled"}
          </p>
          {template.created_at && (
            <p className="text-xs text-gray-400">
              Created {new Date(template.created_at).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="shrink-0">
          <ActionsMenu
            onEdit={() => onEdit(template)}
            onDelete={onDelete ? () => onDelete(template) : null}
            onSettings={onSettings ? () => onSettings(template) : null}
          />
        </div>
      </div>
    </article>
  );
}

// ─── TemplatesPage ────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [entityId, setEntityId] = useState("");
  const [aliases, setAliases] = useState([]);
  const [aliasSheetTemplate, setAliasSheetTemplate] = useState(null);
  const [aliasTargetTemplates, setAliasTargetTemplates] = useState([]);

  // Date-range filter state — default to "Last 7 days"
  const [dateRange, setDateRange] = useState({
    preset: DEFAULT_PRESET,
    from: "",
    to: "",
  });

  /**
   * Derive the API params to send for the current dateRange state.
   * - Preset with days → send `days`
   * - Custom with dates → send `from` / `to`
   * - Custom with no dates → send nothing (all time)
   */
  const dateApiParams = useMemo(() => {
    if (dateRange.preset.days !== null) {
      return { days: dateRange.preset.days };
    }
    // Custom range
    return {
      from: dateRange.from || undefined,
      to: dateRange.to || undefined,
    };
  }, [dateRange]);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const [response, waResponse, aliasResponse] = await Promise.all([
        api.getTemplates({
          channel:
            filterChannel && filterChannel !== "whatsapp"
              ? filterChannel
              : undefined,
          ...dateApiParams,
        }),
        filterChannel && filterChannel !== "whatsapp"
          ? Promise.resolve({ data: [] })
          : api.getWhatsAppTemplates({
              entityId: entityId || undefined,
              source: "cache",
              status: "ALL",
            }),
        api.getTemplateAliases({ entityId: entityId || undefined }),
      ]);
      const localRows = (response.data || []).filter(
        (row) => row.channel !== "whatsapp",
      );
      const waRows = (waResponse.data || []).map((row) => ({
        ...row,
        source: "meta",
        is_active: String(row.status || "").toUpperCase() === "APPROVED",
        created_at: row.cached_at,
      }));
      const merged =
        filterChannel === "whatsapp" ? waRows : [...waRows, ...localRows];
      setTemplates(merged);
      setAliases(aliasResponse.data || []);
    } catch (error) {
      toast.error(`Failed to load templates: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [filterChannel, dateApiParams, entityId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      try {
        const response = await api.listWhatsAppSessions("active");
        if (cancelled) return;
        const list = response.sessions || [];
        setSessions(list);
        if (list.length === 1) {
          setEntityId(list[0].entity_id);
        }
      } catch {
        if (!cancelled) setSessions([]);
      }
    }
    loadSessions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPage(1);
    fetchTemplates();
  }, [fetchTemplates]);

  async function handleDelete(template) {
    if (template.source === "meta") return;
    if (!confirm("Delete this template permanently?")) return;
    try {
      await api.deleteTemplate(template.id);
      toast.success("Template deleted");
      fetchTemplates();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function handleSync() {
    if (sessions.length > 1 && !entityId) {
      toast.error("Select a WhatsApp session before syncing");
      return;
    }
    setSyncing(true);
    try {
      const result = await api.syncWhatsAppTemplates({
        entityId: entityId || undefined,
      });
      const stats = result.data || {};
      toast.success(
        `Synced ${stats.total || 0}: ${stats.created || 0} new, ${stats.updated || 0} updated, ${stats.skipped || 0} skipped, ${stats.pruned || 0} pruned`,
      );
      if (result.truncated || stats.truncated) {
        toast.error(
          result.error || "Sync was rate-limited. Some templates may be missing.",
        );
      }
      fetchTemplates();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveAlias(alias) {
    try {
      await api.saveTemplateAlias(alias);
      toast.success(alias.id ? "Template alias updated" : "Template alias saved");
      const response = await api.getTemplateAliases({
        entityId: entityId || undefined,
      });
      setAliases(response.data || []);
    } catch (error) {
      toast.error(error.message);
      throw error;
    }
  }

  async function handleDeleteAlias(alias) {
    try {
      await api.deleteTemplateAlias(alias.id);
      toast.success("Template alias removed");
      setAliases((current) => current.filter((item) => item.id !== alias.id));
    } catch (error) {
      toast.error(error.message);
      throw error;
    }
  }

  async function handleAliasSettings(template) {
    if (template.channel === "whatsapp" && !entityId) {
      toast.error("Select a WhatsApp session before configuring aliases");
      return;
    }
    try {
      const response =
        template.channel === "whatsapp"
          ? await api.getWhatsAppTemplates({
              entityId,
              source: "cache",
              status: "ALL",
            })
          : await api.getTemplates({ channel: template.channel });
      setAliasTargetTemplates(response.data || []);
      setAliasSheetTemplate(template);
    } catch (error) {
      toast.error(`Failed to load alias targets: ${error.message}`);
    }
  }

  const aliasesByType = useMemo(
    () =>
      new Map(
        aliases.map((alias) => [
          `${alias.channel}:${alias.notification_type}`,
          alias.resolves_to,
        ]),
      ),
    [aliases],
  );

  const searchTokens = useMemo(() => toSearchTokens(filterType), [filterType]);
  const filteredTemplates = useMemo(() => {
    if (searchTokens.length === 0) return templates;
    return templates.filter((template) =>
      matchesTokens(buildTemplateSearchText(template), searchTokens),
    );
  }, [templates, searchTokens]);

  const totalItems = filteredTemplates.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);

  const paginatedTemplates = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredTemplates.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [currentPage, filteredTemplates]);

  const startItem =
    totalItems === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endItem = Math.min(currentPage * ITEMS_PER_PAGE, totalItems);

  function goToPage(nextPage) {
    setPage(Math.max(1, Math.min(nextPage, totalPages)));
  }

  function handleEdit(template) {
    if (template.source === "meta") {
      navigate(`/templates/whatsapp/${encodeURIComponent(template.name)}/edit`);
      return;
    }
    navigate(`/templates/${template.id}/edit`);
  }

  // Human-readable label for the active date filter
  const activeDateLabel = useMemo(() => {
    if (dateRange.preset.days !== null) return dateRange.preset.label;
    const parts = [];
    if (dateRange.from) parts.push(`from ${dateRange.from}`);
    if (dateRange.to) parts.push(`to ${dateRange.to}`);
    return parts.length ? parts.join(" ") : "All time";
  }, [dateRange]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Templates</h2>
          <p className="text-sm text-gray-500">
            Manage default and condition-based templates across channels.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sessions.length > 1 ? (
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
            >
              <option value="">Select WhatsApp session</option>
              {sessions.map((session) => (
                <option key={session.entity_id} value={session.entity_id}>
                  {session.entity_id}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-semibold text-green-800 hover:bg-green-100 disabled:opacity-50"
          >
            <CloudDownload size={16} className={syncing ? "animate-pulse" : ""} />
            {syncing ? "Syncing..." : "Sync WhatsApp via Meta"}
          </button>
          <button
            onClick={() => navigate("/templates/new")}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <Plus size={16} />
            New Template
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          {/* Row 1: search + channel + refresh */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-1 lg:items-center">
              <input
                type="text"
                value={filterType}
                onChange={(e) => {
                  setFilterType(e.target.value);
                  setPage(1);
                }}
                placeholder="Search by type, title, rule..."
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 lg:max-w-xs"
              />
              <select
                value={filterChannel}
                onChange={(e) => setFilterChannel(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 lg:max-w-xs"
              >
                <option value="">All channels</option>
                {TEMPLATE_CHANNELS.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={fetchTemplates}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 shadow-sm hover:bg-gray-50 sm:w-auto"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          {/* Row 2: date-range filter */}
          <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPage(1); }} />
        </div>

        {/* Summary bar */}
        <div className="mt-3 flex flex-col gap-1 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {totalItems
              ? `Showing ${startItem}–${endItem} of ${totalItems}`
              : "No templates found"}
            {" · "}
            <span className="text-gray-400">{activeDateLabel}</span>
          </span>
          <span>
            Page {currentPage} of {totalPages}
          </span>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="font-medium text-gray-500">No templates found</p>
          <p className="mt-1 text-sm text-gray-400">
            Try a different date range, or{" "}
            <button
              onClick={() => navigate("/templates/new")}
              className="text-indigo-500 underline-offset-2 hover:underline"
            >
              create a new template
            </button>
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {paginatedTemplates.map((template) => (
              <TemplateCard
                key={template.id || `${template.name}-${template.language}`}
                template={template}
                onEdit={handleEdit}
                onDelete={
                  template.source === "meta" ? null : handleDelete
                }
                onSettings={handleAliasSettings}
                aliasTarget={aliasesByType.get(
                  `${template.channel}:${template.type}`,
                )}
              />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] table-fixed text-sm">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[18%]" />
                  <col className="w-[11%]" />
                  <col className="w-[18%]" />
                  <col className="w-[13%]" />
                  <col className="w-[9%]" />
                  <col className="w-[5%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left font-medium text-gray-600">
                      Type
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">
                      Rule
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">
                      Channel
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">
                      Created
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedTemplates.map((template) => {
                    const channelConfig = getTemplateChannelConfig(
                      template.channel,
                    );
                    return (
                      <tr
                        key={template.id}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                      >
                        <td className="px-4 py-3">
                          <span
                            className="block truncate font-mono text-xs text-gray-700"
                            title={template.type}
                          >
                            {template.type}
                          </span>
                          {aliasesByType.get(
                            `${template.channel}:${template.type}`,
                          ) ? (
                            <span
                              className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700"
                              title={`${template.channel} resolves to ${aliasesByType.get(`${template.channel}:${template.type}`)}`}
                            >
                              <Link2 size={10} className="shrink-0" />
                              <span className="truncate">
                                uses{" "}
                                {aliasesByType.get(
                                  `${template.channel}:${template.type}`,
                                )}
                              </span>
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="block truncate text-xs text-gray-600"
                            title={getRuleLabel(template)}
                          >
                            {getRuleLabel(template)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              channelConfig.badgeClass ||
                              "bg-gray-50 text-gray-700"
                            }`}
                          >
                            {channelConfig.label || template.channel}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="block truncate text-gray-700"
                            title={template.title}
                          >
                            {template.title || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block truncate text-xs text-gray-500">
                            {template.created_at
                              ? new Date(template.created_at).toLocaleDateString()
                              : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              template.is_active !== false
                                ? "bg-green-50 text-green-700"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {template.source === "meta"
                              ? template.status || "Cached"
                              : template.is_active !== false
                                ? "Active"
                                : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ActionsMenu
                            onEdit={() => handleEdit(template)}
                            onDelete={
                              template.source === "meta"
                                ? null
                                : () => handleDelete(template)
                            }
                            onSettings={() => handleAliasSettings(template)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-gray-500">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ) : null}
        </>
      )}
      {aliasSheetTemplate !== null ? (
        <TemplateAliasSheet
          key={`${entityId}:${aliasSheetTemplate.channel}:${aliasSheetTemplate.type}`}
          entityId={entityId}
          channel={aliasSheetTemplate.channel}
          initialType={
            aliasSheetTemplate.name || aliasSheetTemplate.type || ""
          }
          aliases={aliases}
          channelTemplates={aliasTargetTemplates}
          onSave={handleSaveAlias}
          onDelete={handleDeleteAlias}
          onClose={() => setAliasSheetTemplate(null)}
        />
      ) : null}
    </div>
  );
}