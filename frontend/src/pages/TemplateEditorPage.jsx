import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, Eye, Pencil, Save, RefreshCw } from "lucide-react";
import { api } from "../services/api";
import {
  TEMPLATE_CHANNELS,
  TEMPLATE_FORMATS,
  getTemplateChannelConfig,
} from "../config/templateChannels";
import TemplatePreview from "../components/template/TemplatePreview";
import WhatsAppTemplateEditor from "../components/template/WhatsAppTemplateEditor";
import { parseWhatsAppEditorJson } from "../utils/whatsappTemplateEditor";

const DEFAULT_CHANNEL = TEMPLATE_CHANNELS[0]?.id || "push";
const WHATSAPP_CHANNEL_ID =
  TEMPLATE_CHANNELS.find((channel) => channel.id === "whatsapp")?.id ||
  "whatsapp";

const TEMPLATE_FORMAT_LABELS = TEMPLATE_FORMATS.reduce((acc, format) => {
  acc[format.id] = format.label;
  return acc;
}, {});

function buildEmptyForm(channel = DEFAULT_CHANNEL) {
  const channelConfig = getTemplateChannelConfig(channel);
  return {
    type: "",
    channel,
    title: "",
    body: "",
    body_format: channelConfig.defaultFormat,
    cta_text: "",
    cta_url: "",
    condition_key: "",
    condition_value: "",
    is_active: true,
    language: "en_US",
    category: "UTILITY",
    headerText: "",
    footerText: "",
    buttons: [],
    jsonText: JSON.stringify({ components: [{ type: "BODY", text: "" }] }, null, 2),
    entity_id: "",
  };
}

function normalizeFormFromTemplate(template) {
  const channelConfig = getTemplateChannelConfig(template.channel);
  return {
    type: template.type || "",
    channel: template.channel || DEFAULT_CHANNEL,
    title: template.title || "",
    body: template.body || "",
    body_format: template.body_format || channelConfig.defaultFormat,
    cta_text: template.cta_text || "",
    cta_url: template.cta_url || "",
    condition_key: template.condition_key || "",
    condition_value: template.condition_value || "",
    is_active: template.is_active !== false,
    language: template.language || "en_US",
    category: template.category || "UTILITY",
    headerText: template.header_text || "",
    footerText: template.footer_text || "",
    buttons:
      template.components?.find((c) => c.type === "BUTTONS")?.buttons || [],
    jsonText: JSON.stringify(
      { components: template.components || [] },
      null,
      2,
    ),
    entity_id: template.entity_id || "",
  };
}

export default function TemplateEditorPage() {
  const navigate = useNavigate();
  const { templateId, whatsappName } = useParams();
  const isWhatsAppEdit = Boolean(whatsappName);
  const isEditing = Boolean(templateId) || isWhatsAppEdit;

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("edit");
  const [form, setForm] = useState(() =>
    buildEmptyForm(isWhatsAppEdit ? WHATSAPP_CHANNEL_ID : DEFAULT_CHANNEL),
  );
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      try {
        const response = await api.listWhatsAppSessions("active");
        if (!cancelled) {
          const list = response.sessions || response.data || [];
          setSessions(list);
          setForm((prev) => {
            if (prev.entity_id || list.length !== 1) return prev;
            return { ...prev, entity_id: list[0].entity_id };
          });
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
    if (!isEditing) return;

    let cancelled = false;
    async function loadTemplate() {
      setLoading(true);
      try {
        const response = isWhatsAppEdit
          ? await api.getWhatsAppTemplate(whatsappName, { source: "cache" })
          : await api.getTemplate(templateId);
        if (!cancelled) {
          setForm(
            isWhatsAppEdit
              ? normalizeFormFromTemplate({
                  ...response.data,
                  channel: WHATSAPP_CHANNEL_ID,
                  type: response.data.name,
                  body: response.data.body_text,
                })
              : normalizeFormFromTemplate(response.data),
          );
        }
      } catch (error) {
        toast.error(`Failed to load template: ${error.message}`);
        navigate("/templates", { replace: true });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadTemplate();
    return () => {
      cancelled = true;
    };
  }, [isEditing, isWhatsAppEdit, navigate, templateId, whatsappName]);

  const channelConfig = getTemplateChannelConfig(form.channel);
  const showFormatSelect = (channelConfig.formats || []).length > 1;
  const titleLabel = channelConfig.titleLabel || "Title";
  const bodyLabel = channelConfig.supportsTitle ? "Body" : "Message";

  function updateFormField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
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

  const isWhatsApp = form.channel === WHATSAPP_CHANNEL_ID;

  async function handleSave(event) {
    event.preventDefault();

    if (isWhatsApp) {
      if (isEditing) {
        toast.error(
          "Approved Meta templates cannot be edited here. Change them in Meta Manager, then sync.",
        );
        return;
      }
      if (!form.type.trim() || !form.language || !form.category) {
        toast.error("Name, language, and category are required");
        return;
      }
      if (sessions.length > 1 && !form.entity_id) {
        toast.error("Select a WhatsApp session");
        return;
      }

      let components;
      if (form.body_format === "json") {
        try {
          const parsed = parseWhatsAppEditorJson(form.jsonText);
          components = parsed.components;
        } catch (error) {
          toast.error(error.message || "Invalid JSON");
          return;
        }
      } else if (!form.body.trim()) {
        toast.error("Body is required");
        return;
      }

      setSaving(true);
      try {
        const response = await api.createWhatsAppTemplate({
          entity_id: form.entity_id || undefined,
          name: form.type.trim(),
          language: form.language,
          category: form.category,
          ...(form.body_format === "json"
            ? { components }
            : {
                body: form.body,
                header_text: form.headerText,
                footer_text: form.footerText,
                buttons: form.buttons,
              }),
        });
        if (response.cached === false) {
          toast.success("Created on Meta. Cache missed — tap Sync on Templates.");
        } else {
          toast.success("WhatsApp template submitted to Meta");
        }
        navigate("/templates");
      } catch (error) {
        toast.error(error.message);
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!form.type.trim() || !form.body.trim()) {
      toast.error("Type and body are required");
      return;
    }

    const hasConditionKey = Boolean(form.condition_key.trim());
    const hasConditionValue = Boolean(form.condition_value.trim());
    if (hasConditionKey !== hasConditionValue) {
      toast.error("Condition key and value must be set together");
      return;
    }

    const payload = {
      type: form.type.trim(),
      channel: form.channel,
      title: form.title.trim() || null,
      body: form.body,
      body_format: form.body_format,
      cta_text: form.cta_text.trim() || null,
      cta_url: form.cta_url.trim() || null,
      condition_key: form.condition_key.trim() || null,
      condition_value: form.condition_value.trim() || null,
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      if (isEditing) {
        await api.updateTemplate(templateId, payload);
        toast.success("Template updated");
      } else {
        await api.createTemplate(payload);
        toast.success("Template created");
      }
      navigate("/templates");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate("/templates")}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back to templates
          </button>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("edit")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "edit"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-gray-600"
              }`}
            >
              <Pencil size={14} />
              Edit
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "preview"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-gray-600"
              }`}
            >
              <Eye size={14} />
              Preview
            </button>
          </div>
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {isEditing ? "Edit Template" : "Create Template"}
          </h2>
          <p className="text-sm text-gray-500">{channelConfig.description}</p>
        </div>
      </div>


      <form onSubmit={handleSave} className="space-y-4">
        {activeTab === "edit" ? (
          isWhatsApp ? (
            <>
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Channel
                    </label>
                    <select
                      value={form.channel}
                      onChange={(e) => handleChannelChange(e.target.value)}
                      disabled={isEditing}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50"
                    >
                      {TEMPLATE_CHANNELS.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {sessions.length > 0 ? (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        WhatsApp session
                      </label>
                      <select
                        value={form.entity_id}
                        onChange={(e) =>
                          updateFormField("entity_id", e.target.value)
                        }
                        disabled={isEditing}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50"
                      >
                        <option value="">
                          {sessions.length === 1 ? "Default session" : "Select session"}
                        </option>
                        {sessions.map((session) => (
                          <option key={session.entity_id} value={session.entity_id}>
                            {session.entity_id}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
                {isEditing ? (
                  <p className="mt-3 text-xs text-amber-600">
                    Synced Meta templates are read-only here. Edit in Meta Manager, then sync.
                  </p>
                ) : null}
              </section>
              <WhatsAppTemplateEditor
                form={form}
                onChange={setForm}
                isEditing={isEditing}
              />
            </>
          ) : (
          <>
            <section className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Type <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.type}
                    onChange={(e) => updateFormField("type", e.target.value)}
                    placeholder="join_request_status_updated"
                    disabled={isEditing}
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
                    disabled={isEditing}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    {TEMPLATE_CHANNELS.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Condition key (optional)
                  </label>
                  <input
                    type="text"
                    value={form.condition_key}
                    onChange={(e) =>
                      updateFormField("condition_key", e.target.value)
                    }
                    placeholder="e.g. request_status"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Use any key your product understands. Leave it empty for the
                    default template.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Condition value (optional)
                  </label>
                  <input
                    type="text"
                    value={form.condition_value}
                    onChange={(e) =>
                      updateFormField("condition_value", e.target.value)
                    }
                    placeholder="e.g. APPROVED"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Set the matching value for the key above. Both fields are
                    required together.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
              {channelConfig.supportsTitle ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {titleLabel}
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => updateFormField("title", e.target.value)}
                    placeholder={channelConfig.titlePlaceholder || "Title"}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              ) : null}

              {showFormatSelect ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Body format
                  </label>
                  <select
                    value={form.body_format}
                    onChange={(e) =>
                      updateFormField("body_format", e.target.value)
                    }
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

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {bodyLabel} <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={form.body}
                  onChange={(e) => updateFormField("body", e.target.value)}
                  rows={8}
                  placeholder={channelConfig.bodyPlaceholder || "Template body"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <div className="mt-1 space-y-0.5 text-xs text-gray-400">
                  {channelConfig.bodyHelp ? <p>{channelConfig.bodyHelp}</p> : null}
                  <p>Use {"{{variable}}"} placeholders for dynamic content.</p>
                </div>
              </div>

              {channelConfig.supportsCta ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      CTA Text
                    </label>
                    <input
                      type="text"
                      value={form.cta_text}
                      onChange={(e) =>
                        updateFormField("cta_text", e.target.value)
                      }
                      placeholder={channelConfig.ctaPlaceholder || "View details"}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      CTA Link (optional)
                    </label>
                    <input
                      type="text"
                      value={form.cta_url}
                      onChange={(e) => updateFormField("cta_url", e.target.value)}
                      placeholder="https://app.example.com/requests/{{join_request_id}}"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      If you skip this, CTA can still work using action_url in
                      /notify payload.
                    </p>
                  </div>
                </>
              ) : null}

              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => updateFormField("is_active", e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Active template
              </label>
            </section>
          </>
          )
        ) : (
          <TemplatePreview
            channel={form.channel}
            title={isWhatsApp ? form.headerText : form.title}
            body={
              isWhatsApp && form.body_format === "json"
                ? form.jsonText
                : isWhatsApp
                  ? form.body
                  : form.body
            }
            bodyFormat={form.body_format}
            ctaText={form.cta_text}
            actionUrl={form.cta_url}
            headerText={form.headerText}
            footerText={form.footerText}
            buttons={form.buttons}
          />
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate("/templates")}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || (isWhatsApp && isEditing)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save size={14} />
            {saving
              ? "Saving..."
              : isWhatsApp && isEditing
                ? "Read only"
                : isEditing
                  ? "Update Template"
                  : "Create Template"}
          </button>
        </div>
      </form>
    </div>
  );
}
