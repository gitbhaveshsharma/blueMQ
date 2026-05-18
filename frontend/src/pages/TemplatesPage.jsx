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
} from "lucide-react";
import { api } from "../services/api";
import {
  TEMPLATE_CHANNELS,
  getTemplateChannelConfig,
} from "../config/templateChannels";

const ITEMS_PER_PAGE = 8;

function getRuleLabel(template) {
  if (template.condition_key && template.condition_value) {
    return `${template.condition_key} = ${template.condition_value}`;
  }
  return "Default";
}

// Three-dot popover menu
function ActionsMenu({ onEdit, onDelete }) {
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
            onClick={() => { onEdit(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Pencil size={13} className="text-gray-400" />
            Edit
          </button>
          <button
            onClick={() => { onDelete(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 size={13} className="text-red-400" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template, onEdit, onDelete }) {
  const channelConfig = getTemplateChannelConfig(template.channel);

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-gray-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium text-gray-700 break-all">
              {template.type}
            </span>
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
            </span>
          </div>
          <p className="text-xs text-gray-500">{getRuleLabel(template)}</p>
          <p className="text-sm font-medium text-gray-900 truncate">
            {template.title || "Untitled"}
          </p>
        </div>
        <div className="shrink-0">
          <ActionsMenu onEdit={() => onEdit(template.id)} onDelete={() => onDelete(template.id)} />
        </div>
      </div>
    </article>
  );
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [page, setPage] = useState(1);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getTemplates({
        type: filterType || undefined,
        channel: filterChannel || undefined,
      });
      setTemplates(response.data || []);
    } catch (error) {
      toast.error(`Failed to load templates: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [filterChannel, filterType]);

  useEffect(() => {
    setPage(1);
    fetchTemplates();
  }, [fetchTemplates]);

  async function handleDelete(templateId) {
    if (!confirm("Delete this template permanently?")) return;
    try {
      await api.deleteTemplate(templateId);
      toast.success("Template deleted");
      fetchTemplates();
    } catch (error) {
      toast.error(error.message);
    }
  }

  const totalItems = templates.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);

  const paginatedTemplates = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return templates.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [currentPage, templates]);

  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endItem = Math.min(currentPage * ITEMS_PER_PAGE, totalItems);

  function goToPage(nextPage) {
    setPage(Math.max(1, Math.min(nextPage, totalPages)));
  }

  function handleEdit(templateId) {
    navigate(`/templates/${templateId}/edit`);
  }

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
        <button
          onClick={() => navigate("/templates/new")}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          <Plus size={16} />
          New Template
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-1 lg:items-center">
            <input
              type="text"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              placeholder="Filter by type..."
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
        <div className="mt-3 flex flex-col gap-1 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {totalItems
              ? `Showing ${startItem}–${endItem} of ${totalItems}`
              : "No templates found"}
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
          <p className="font-medium text-gray-500">No templates yet</p>
          <p className="mt-1 text-sm text-gray-400">
            Create your first template to get started
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {paginatedTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {/* Desktop table — no CTA column, fixed layout to prevent overflow */}
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] table-fixed text-sm">
                <colgroup>
                  {/* Type: widest since it has long mono strings */}
                  <col className="w-[30%]" />
                  {/* Rule */}
                  <col className="w-[22%]" />
                  {/* Channel */}
                  <col className="w-[12%]" />
                  {/* Title */}
                  <col className="w-[22%]" />
                  {/* Status */}
                  <col className="w-[10%]" />
                  {/* Actions */}
                  <col className="w-[4%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Rule</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Channel</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedTemplates.map((template) => {
                    const channelConfig = getTemplateChannelConfig(template.channel);
                    return (
                      <tr
                        key={template.id}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                      >
                        <td className="px-4 py-3">
                          <span className="block truncate font-mono text-xs text-gray-700" title={template.type}>
                            {template.type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block truncate text-xs text-gray-600" title={getRuleLabel(template)}>
                            {getRuleLabel(template)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              channelConfig.badgeClass || "bg-gray-50 text-gray-700"
                            }`}
                          >
                            {channelConfig.label || template.channel}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block truncate text-gray-700" title={template.title}>
                            {template.title || "—"}
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
                            {template.is_active !== false ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ActionsMenu
                            onEdit={() => handleEdit(template.id)}
                            onDelete={() => handleDelete(template.id)}
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
    </div>
  );
}