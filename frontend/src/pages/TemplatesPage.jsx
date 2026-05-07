import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import toast from "react-hot-toast";
import { Plus, Pencil, Trash2, X, RefreshCw, FileText } from "lucide-react";
import {
  TEMPLATE_CHANNELS,
  TEMPLATE_FORMATS,
  getTemplateChannelConfig,
} from "../config/templateChannels";

const DEFAULT_CHANNEL = TEMPLATE_CHANNELS[0]?.id || "push";

const TEMPLATE_FORMAT_LABELS = TEMPLATE_FORMATS.reduce((acc, format) => {
  acc[format.id] = format.label;
  return acc;
}, {});

const CHAT_TONE_CLASSES = {
  sms: "bg-gray-100 text-gray-700",
  whatsapp: "bg-green-100 text-green-800",
};

function buildEmptyForm(channel = DEFAULT_CHANNEL) {
  const channelConfig = getTemplateChannelConfig(channel);
  return {
    type: "",
    channel,
    title: "",
    body: "",
    cta_text: "",
    body_format: channelConfig.defaultFormat,
  };
}

function PreviewCard({ title, body, ctaText }) {
  const hasTitle = Boolean(title?.trim());
  const hasBody = Boolean(body?.trim());

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div
        className={
          hasTitle
            ? "text-sm font-semibold text-gray-900"
            : "text-sm font-semibold text-gray-400 italic"
        }
      >
        {hasTitle ? title : "No title yet"}
      </div>
      <div
        className={
          hasBody
            ? "mt-2 text-sm text-gray-600 whitespace-pre-wrap"
            : "mt-2 text-sm text-gray-400 italic"
        }
      >
        {hasBody ? body : "No body yet"}
      </div>
      {ctaText ? (
        <div className="mt-3 inline-flex rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white">
          {ctaText}
        </div>
      ) : null}
    </div>
  );
}

function PreviewChat({ body, tone }) {
  const hasBody = Boolean(body?.trim());
  const toneClass = CHAT_TONE_CLASSES[tone] || "bg-gray-100 text-gray-700";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${toneClass}`}>
        <div className={hasBody ? "whitespace-pre-wrap" : "text-gray-400 italic"}>
          {hasBody ? body : "No message yet"}
        </div>
      </div>
    </div>
  );
}

function buildEmailPreviewDoc(html) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        color: #111827;
      }
      img { max-width: 100%; height: auto; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>${html || ""}</body>
</html>`;
}

function PreviewEmail({ title, body, bodyFormat, ctaText }) {
  const hasTitle = Boolean(title?.trim());
  const hasBody = Boolean(body?.trim());
  const isHtml = bodyFormat === "html";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">
        Email preview
      </div>
      <div
        className={
          hasTitle
            ? "mt-2 text-base font-semibold text-gray-900"
            : "mt-2 text-base font-semibold text-gray-400 italic"
        }
      >
        {hasTitle ? title : "No subject yet"}
      </div>
      <div className="mt-3 text-sm text-gray-700">
        {isHtml ? (
          hasBody ? (
            <iframe
              title="Email HTML preview"
              sandbox=""
              className="h-48 w-full rounded-lg border border-gray-200 bg-white"
              srcDoc={buildEmailPreviewDoc(body)}
            />
          ) : (
            <div className="text-gray-400 italic">No body yet</div>
          )
        ) : hasBody ? (
          <div className="whitespace-pre-wrap">{body}</div>
        ) : (
          <div className="text-gray-400 italic">No body yet</div>
        )}
      </div>
      {ctaText ? (
        <div className="mt-4 inline-flex rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white">
          {ctaText}
        </div>
      ) : null}
    </div>
  );
}

const PREVIEW_RENDERERS = {
  card: PreviewCard,
  chat: PreviewChat,
  email: PreviewEmail,
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(() => buildEmptyForm());
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const channelConfig = getTemplateChannelConfig(form.channel);
  const PreviewRenderer =
    PREVIEW_RENDERERS[channelConfig.previewType] || PreviewCard;
  const titleLabel = channelConfig.titleLabel || "Title";
  const bodyLabel = channelConfig.supportsTitle ? "Body" : "Message";
  const showFormatSelect = (channelConfig.formats || []).length > 1;

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTemplates({
        type: filterType || undefined,
        channel: filterChannel || undefined,
      });
      setTemplates(data.data || []);
    } catch (err) {
      toast.error("Failed to load templates: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [filterType, filterChannel]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTemplates();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchTemplates]);

  function openCreate() {
    setEditingId(null);
    setForm(buildEmptyForm());
    setShowModal(true);
  }

  function openEdit(tpl) {
    const editChannelConfig = getTemplateChannelConfig(tpl.channel);
    setEditingId(tpl.id);
    setForm({
      type: tpl.type,
      channel: tpl.channel,
      title: tpl.title || "",
      body: tpl.body || "",
      cta_text: tpl.cta_text || "",
      body_format: tpl.body_format || editChannelConfig.defaultFormat,
    });
    setShowModal(true);
  }

  function handleChannelChange(nextChannel) {
    const nextConfig = getTemplateChannelConfig(nextChannel);
    setForm((prev) => ({
      ...prev,
      channel: nextChannel,
      body_format: nextConfig.formats.includes(prev.body_format)
        ? prev.body_format
        : nextConfig.defaultFormat,
    }));
  }

  async function handleDelete(id) {
    if (!confirm("Delete this template permanently?")) return;
    try {
      await api.deleteTemplate(id);
      toast.success("Template deleted");
      fetchTemplates();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.type.trim() || !form.body.trim()) {
      toast.error("Type and Body are required");
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await api.updateTemplate(editingId, {
          title: form.title || null,
          body: form.body,
          body_format: form.body_format,
          cta_text: form.cta_text || null,
        });
        toast.success("Template updated");
      } else {
        await api.createTemplate(form);
        toast.success("Template created");
      }
      setShowModal(false);
      fetchTemplates();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Templates</h2>
          <p className="text-sm text-gray-500">
            Manage notification templates for all channels
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus size={16} />
          New Template
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          placeholder="Filter by type..."
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        <select
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="">All channels</option>
          {TEMPLATE_CHANNELS.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.label}
            </option>
          ))}
        </select>
        <button
          onClick={fetchTemplates}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 shadow-sm hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Table */}
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
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Channel</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 hidden md:table-cell">Body</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => {
                const rowChannelConfig = getTemplateChannelConfig(tpl.channel);
                return (
                  <tr
                    key={tpl.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{tpl.type}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          rowChannelConfig.badgeClass || "bg-gray-50 text-gray-700"
                        }`}
                      >
                        {rowChannelConfig.label || tpl.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-50 truncate">
                      {tpl.title || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-75 truncate hidden md:table-cell">
                      {tpl.body}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          tpl.is_active !== false
                            ? "bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {tpl.is_active !== false ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(tpl)}
                          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(tpl.id)}
                          className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── MODAL ─────────────────────────────────────────────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-6"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          {/*
            max-w-2xl  → wider (672 px) instead of the old max-w-lg (512 px)
            max-h-[90vh] → never taller than 90 % of the viewport
            flex flex-col → lets header / footer stay fixed while body scrolls
          */}
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

            {/* ── Sticky header ───────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingId ? "Edit Template" : "Create Template"}
                </h3>
                <p className="mt-0.5 text-sm text-gray-500">
                  {channelConfig.description}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="ml-4 shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* ── Scrollable body ─────────────────────────────────────────────── */}
            <div className="overflow-y-auto flex-1 px-6 py-5">
              <form id="template-form" onSubmit={handleSave} className="space-y-4">

                {/* Type + Channel */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Type <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value })}
                      placeholder="fee_due"
                      disabled={!!editingId}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50 disabled:text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Channel <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={form.channel}
                      onChange={(e) => handleChannelChange(e.target.value)}
                      disabled={!!editingId}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50 disabled:text-gray-500"
                    >
                      {TEMPLATE_CHANNELS.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Title (optional per channel) */}
                {channelConfig.supportsTitle ? (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      {titleLabel}
                    </label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      placeholder={channelConfig.titlePlaceholder || "Template title"}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                ) : null}

                {/* Body format (optional per channel) */}
                {showFormatSelect ? (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Body format
                    </label>
                    <select
                      value={form.body_format}
                      onChange={(e) => setForm({ ...form, body_format: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      {channelConfig.formats.map((format) => (
                        <option key={format} value={format}>
                          {TEMPLATE_FORMAT_LABELS[format] || format}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {/* Body */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {bodyLabel} <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    rows={4}
                    placeholder={channelConfig.bodyPlaceholder || "Template message"}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <div className="mt-1 space-y-0.5 text-xs text-gray-400">
                    {channelConfig.bodyHelp ? <p>{channelConfig.bodyHelp}</p> : null}
                    <p>Use {"{{variable}}"} placeholders for dynamic content</p>
                  </div>
                </div>

                {/* CTA (optional per channel) */}
                {channelConfig.supportsCta ? (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      CTA Text
                    </label>
                    <input
                      type="text"
                      value={form.cta_text}
                      onChange={(e) => setForm({ ...form, cta_text: e.target.value })}
                      placeholder={channelConfig.ctaPlaceholder || "View details"}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                ) : null}

                {/* Preview */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Preview</span>
                    <span className="text-xs text-gray-400">{channelConfig.label}</span>
                  </div>
                  <PreviewRenderer
                    title={form.title}
                    body={form.body}
                    bodyFormat={form.body_format}
                    ctaText={form.cta_text}
                    tone={channelConfig.previewTone}
                  />
                </div>

              </form>
            </div>

            {/* ── Sticky footer ────────────────────────────────────────────────── */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-white shrink-0">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="template-form"
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : editingId ? "Update" : "Create"}
              </button>
            </div>

          </div>
        </div>
      )}
      {/* ─────────────────────────────────────────────────────────────────────── */}

    </div>
  );
}