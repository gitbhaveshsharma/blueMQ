import {
  createElement,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { api } from "../services/api";
import toast from "react-hot-toast";
import {
  Send,
  Plus,
  Minus,
  Users,
  User,
  ChevronDown,
  ChevronUp,
  Clock,
  Mail,
  MessageSquare,
  Bell,
  Layers,
  RefreshCw,
  X,
  Search,
  Calendar,
  Repeat,
  Bold,
  Italic,
  UnderlineIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  Heading1,
  Heading2,
  Minus as HrIcon,
  Code,
  Eye,
  Edit3,
  Zap,
  ChevronRight,
  Link2,
} from "lucide-react";
import WhatsAppIcon from "../components/icons/WhatsAppIcon";
import AudienceManager from "../components/audience/AudienceManager";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNELS = [
  { id: "push", label: "Push", Icon: Bell, color: "blue" },
  { id: "email", label: "Email", Icon: Mail, color: "violet" },
  { id: "sms", label: "SMS", Icon: MessageSquare, color: "amber" },
  { id: "whatsapp", label: "WhatsApp", Icon: WhatsAppIcon, color: "green" },
  { id: "in_app", label: "In-App", Icon: Layers, color: "rose" },
];

const CHANNEL_COLORS = {
  blue: {
    pill: "bg-blue-600 text-white",
    off: "border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100",
    badge: "bg-blue-100 text-blue-700",
    accent: "#3b82f6",
  },
  violet: {
    pill: "bg-violet-600 text-white",
    off: "border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100",
    badge: "bg-violet-100 text-violet-700",
    accent: "#7c3aed",
  },
  amber: {
    pill: "bg-amber-500 text-white",
    off: "border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100",
    badge: "bg-amber-100 text-amber-700",
    accent: "#d97706",
  },
  green: {
    pill: "bg-green-600 text-white",
    off: "border border-green-200 bg-green-50 text-green-600 hover:bg-green-100",
    badge: "bg-green-100 text-green-700",
    accent: "#16a34a",
  },
  rose: {
    pill: "bg-rose-600 text-white",
    off: "border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100",
    badge: "bg-rose-100 text-rose-700",
    accent: "#e11d48",
  },
};

const FREQUENCIES = ["daily", "weekly", "monthly", "custom_cron"];
const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract {{var_name}} placeholders from a string. */
function extractVars(text) {
  if (!text) return [];
  const matches = [...text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

/**
 * Text scanned for {{placeholders}}. WhatsApp content is read-only Meta copy,
 * so it publishes the placeholder list Meta expects (which also covers
 * dynamic buttons) instead of the editable subject/body.
 */
function variableText(content) {
  if (!content) return "";
  return [
    content.subject || "",
    content.body || "",
    content.templateVarsText || "",
  ].join(" ");
}

/** Count SMS segments (1 segment = 160 GSM7 chars). */
function smsSegmentCount(text) {
  const len = (text || "").length;
  if (len <= 160) return 1;
  return Math.ceil(len / 153);
}

/** Normalise text so "Fee Due" and "fee_due" compare equal. */
function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Loose match used by the type search — higher score = better match. */
function matchScore(candidate, query) {
  const c = normalizeSearchText(candidate);
  const q = normalizeSearchText(query);
  if (!q) return 1;
  if (c === q) return 100;
  if (c.startsWith(q)) return 80;
  if (c.includes(q)) return 60;

  const tokens = q.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => c.includes(token))) return 40;

  // Fall back to a subsequence check so "fd" still finds "fee_due".
  const flatCandidate = c.replace(/ /g, "");
  const flatQuery = q.replace(/ /g, "");
  let cursor = 0;
  for (const char of flatQuery) {
    cursor = flatCandidate.indexOf(char, cursor);
    if (cursor === -1) return -1;
    cursor += 1;
  }
  return 20;
}

const WA_STATUS_STYLES = {
  APPROVED: "bg-green-100 text-green-700",
  PENDING: "bg-amber-100 text-amber-700",
  IN_APPEAL: "bg-amber-100 text-amber-700",
  PENDING_DELETION: "bg-orange-100 text-orange-700",
  PAUSED: "bg-orange-100 text-orange-700",
  REJECTED: "bg-red-100 text-red-700",
  DISABLED: "bg-red-100 text-red-700",
  DELETED: "bg-gray-200 text-gray-600",
};

function waStatusClass(status) {
  return (
    WA_STATUS_STYLES[String(status || "").toUpperCase()] ||
    "bg-gray-100 text-gray-600"
  );
}

function isApprovedStatus(status) {
  return String(status || "").toUpperCase() === "APPROVED";
}

function channelLabel(channel) {
  return CHANNELS.find((c) => c.id === channel)?.label || channel;
}

/** Build a CSS class string for the input field */
const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all";

const labelCls = "mb-1.5 block text-sm font-medium text-gray-700";

// ─── Email Tiptap Toolbar ─────────────────────────────────────────────────────

function EmailToolbar({ editor }) {
  if (!editor) return null;

  const btn = (title, isActive, onClick, Icon) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`rounded p-1.5 transition-colors ${
        isActive
          ? "bg-indigo-600 text-white"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      }`}
    >
      {createElement(Icon, { size: 14 })}
    </button>
  );

  function handleLink() {
    const url = prompt("Enter URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }

  function handleImage() {
    const url = prompt("Enter image URL:");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-gray-300 border-b-0 bg-gray-50 px-2 py-1.5">
      {btn("Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), Bold)}
      {btn("Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), Italic)}
      {btn("Underline", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), UnderlineIcon)}
      <span className="mx-1 h-4 w-px bg-gray-300" />
      {btn("Heading 1", editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), Heading1)}
      {btn("Heading 2", editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), Heading2)}
      <span className="mx-1 h-4 w-px bg-gray-300" />
      {btn("Align Left", editor.isActive({ textAlign: "left" }), () => editor.chain().focus().setTextAlign("left").run(), AlignLeft)}
      {btn("Align Center", editor.isActive({ textAlign: "center" }), () => editor.chain().focus().setTextAlign("center").run(), AlignCenter)}
      {btn("Align Right", editor.isActive({ textAlign: "right" }), () => editor.chain().focus().setTextAlign("right").run(), AlignRight)}
      {btn("Justify", editor.isActive({ textAlign: "justify" }), () => editor.chain().focus().setTextAlign("justify").run(), AlignJustify)}
      <span className="mx-1 h-4 w-px bg-gray-300" />
      {btn("Bullet list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), List)}
      {btn("Ordered list", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered)}
      {btn("Code", editor.isActive("code"), () => editor.chain().focus().toggleCode().run(), Code)}
      <span className="mx-1 h-4 w-px bg-gray-300" />
      <button
        type="button"
        title="Link"
        onMouseDown={(e) => { e.preventDefault(); handleLink(); }}
        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
      >
        <LinkIcon size={14} />
      </button>
      <button
        type="button"
        title="Image"
        onMouseDown={(e) => { e.preventDefault(); handleImage(); }}
        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
      >
        <ImageIcon size={14} />
      </button>
      <button
        type="button"
        title="Horizontal Rule"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setHorizontalRule().run(); }}
        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
      >
        <HrIcon size={14} />
      </button>
    </div>
  );
}

// ─── Email Channel Section ────────────────────────────────────────────────────

function EmailSection({ content, onChange }) {
  const [mode, setMode] = useState(content.format || "html");
  const [previewMode, setPreviewMode] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({ placeholder: "Compose your email body here…" }),
    ],
    content: mode === "html" ? content.body || "" : "",
    onUpdate: ({ editor }) => {
      if (mode === "html") {
        onChange({ ...content, body: editor.getHTML(), format: "html" });
      }
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[260px] p-3 text-sm text-gray-800 focus:outline-none prose prose-sm max-w-none",
      },
    },
  });

  // Sync mode changes
  useEffect(() => {
    onChange({ ...content, format: mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="space-y-4">
      {/* Subject */}
      <div>
        <label className={labelCls}>Subject <span className="text-red-500">*</span></label>
        <input
          type="text"
          value={content.subject || ""}
          onChange={(e) => onChange({ ...content, subject: e.target.value })}
          placeholder="e.g. Fee reminder for {{student_name}}"
          className={inputCls}
        />
      </div>

      {/* Format toggle */}
      <div className="flex items-center justify-between">
        <label className={labelCls}>Body</label>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
            {["text", "html"].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setMode(f)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  mode === f
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {f === "text" ? "Plain Text" : "HTML"}
              </button>
            ))}
          </div>
          {mode === "html" && (
            <button
              type="button"
              onClick={() => setPreviewMode((v) => !v)}
              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-colors"
            >
              {previewMode ? <Edit3 size={12} /> : <Eye size={12} />}
              {previewMode ? "Edit" : "Preview"}
            </button>
          )}
        </div>
      </div>

      {mode === "html" ? (
        previewMode ? (
          <div
            className="min-h-[260px] rounded-lg border border-gray-300 bg-white p-4 overflow-auto"
            dangerouslySetInnerHTML={{ __html: content.body || "<p class='text-gray-400 text-sm'>Nothing to preview yet.</p>" }}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-300">
            <EmailToolbar editor={editor} />
            <EditorContent editor={editor} />
          </div>
        )
      ) : (
        <textarea
          rows={10}
          value={content.body || ""}
          onChange={(e) => onChange({ ...content, body: e.target.value, format: "text" })}
          placeholder="Hi {{student_name}}, your fee of {{amount}} is due."
          className={`${inputCls} resize-y font-mono`}
        />
      )}

      <p className="text-xs text-gray-400">
        Use <code className="rounded bg-gray-100 px-1">{"{{variable_name}}"}</code> for dynamic content. Variables will be filled below.
      </p>
    </div>
  );
}

// ─── SMS Section ──────────────────────────────────────────────────────────────

function SmsSection({ content, onChange, templates }) {
  const body = content.body || "";
  const charCount = body.length;
  const segments = smsSegmentCount(body);

  return (
    <div className="space-y-3">
      {templates.length > 0 && (
        <TemplateSelector
          channel="sms"
          templates={templates}
          onSelect={(t) => onChange({ ...content, body: t.body || "", templateId: t.id })}
        />
      )}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className={labelCls}>Message</label>
          <span className={`text-xs font-medium ${charCount > 320 ? "text-red-500" : "text-gray-400"}`}>
            {charCount} chars · {segments} segment{segments > 1 ? "s" : ""}
          </span>
        </div>
        <textarea
          rows={6}
          value={body}
          onChange={(e) => onChange({ ...content, body: e.target.value, format: "text" })}
          placeholder="Your fee of {{amount}} is due. Click here to pay: {{payment_link}}"
          className={`${inputCls} resize-y`}
        />
        <p className="mt-1 text-xs text-gray-400">
          Use <code className="rounded bg-gray-100 px-1">{"{{variable_name}}"}</code> for dynamic content.
        </p>
      </div>
    </div>
  );
}

// ─── WhatsApp Section ─────────────────────────────────────────────────────────

function WhatsAppSection({
  content,
  onChange,
  notifType,
  waTemplates,
  templateAliases,
  loading,
  error,
  onReload,
}) {
  const activeAlias = templateAliases.find(
    (alias) =>
      alias.channel === "whatsapp" &&
      normalizeSearchText(alias.notification_type) ===
        normalizeSearchText(notifType),
  );
  const resolvedTemplateName = activeAlias?.resolves_to || notifType;
  const typeKey = normalizeSearchText(resolvedTemplateName);

  const matches = useMemo(() => {
    if (!typeKey) return [];
    // The cache can hold the same name under several entities — one row per
    // language is enough here, preferring an approved one.
    const byLanguage = new Map();
    for (const tpl of waTemplates) {
      if (normalizeSearchText(tpl.name) !== typeKey) continue;
      const current = byLanguage.get(tpl.language);
      if (!current || (!isApprovedStatus(current.status) && isApprovedStatus(tpl.status))) {
        byLanguage.set(tpl.language, tpl);
      }
    }
    return [...byLanguage.values()];
  }, [waTemplates, typeKey]);

  const selected = useMemo(() => {
    if (matches.length === 0) return null;
    const chosen = matches.find(
      (tpl) => tpl.language === content.templateLanguage,
    );
    if (chosen) return chosen;
    return matches.find((tpl) => isApprovedStatus(tpl.status)) || matches[0];
  }, [matches, content.templateLanguage]);

  // Keep the parent content in sync: the template text drives the placeholders
  // rendered by the Template Variables section.
  useEffect(() => {
    if (!selected) {
      if (content.templateName) {
        onChange({
          ...content,
          templateName: "",
          templateLanguage: "",
          templateStatus: "",
          templateHeader: "",
          templateBody: "",
          templateFooter: "",
          templateVarsText: "",
        });
      }
      return;
    }

    if (
      content.templateName === selected.name &&
      content.templateLanguage === selected.language &&
      content.templateStatus === selected.status
    ) {
      return;
    }

    onChange({
      ...content,
      templateName: selected.name,
      templateLanguage: selected.language,
      templateStatus: selected.status,
      templateId: selected.meta_id || selected.id,
      templateHeader: selected.header_text || "",
      templateBody: selected.body_text || "",
      templateFooter: selected.footer_text || "",
      templateVarsText: (selected.variables || [])
        .map((v) => `{{${v.index}}}`)
        .join(" "),
      format: "text",
    });
  }, [selected, content, onChange]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
        <RefreshCw size={14} className="animate-spin" />
        Loading synced WhatsApp templates…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p>{error}</p>
        <button
          type="button"
          onClick={onReload}
          className="mt-2 text-xs font-medium text-red-700 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!typeKey) {
    return (
      <p className="py-4 text-sm text-gray-400">
        Pick a Notification Type above — the matching WhatsApp template loads
        here automatically.
      </p>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-medium">
          No synced WhatsApp template named “{resolvedTemplateName.trim()}”
        </p>
        {activeAlias ? (
          <p className="mt-1 text-xs">
            <code>{activeAlias.notification_type}</code> is aliased to{" "}
            <code>{activeAlias.resolves_to}</code>, which is not in the cache.
          </p>
        ) : null}
        <p className="mt-1 text-xs">
          Run <span className="font-semibold">Sync WhatsApp via Meta</span> on
          the Templates page, or create the template there. Until then WhatsApp
          sends a plain-text fallback message.
        </p>
      </div>
    );
  }

  const approved = isApprovedStatus(selected?.status);

  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border p-4 space-y-3 ${
          approved
            ? "border-green-200 bg-green-50"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        {activeAlias ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-2 text-xs text-indigo-800">
            <Link2 size={12} className="shrink-0" />
            <span>Alias — this send uses</span>
            <code className="rounded bg-white px-1.5 py-0.5 font-semibold">
              {activeAlias.resolves_to}
            </code>
            <span className="text-indigo-500">
              instead of {activeAlias.notification_type}
            </span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">
              {selected.name}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {selected.language}
              {selected.category ? ` · ${selected.category}` : ""}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${waStatusClass(
              selected.status,
            )}`}
          >
            {selected.status || "UNKNOWN"}
          </span>
        </div>

        {!approved && (
          <p className="text-xs text-amber-800">
            Meta has not approved this template, so it cannot be sent as a
            template yet. WhatsApp will fall back to a plain-text message.
          </p>
        )}

        {matches.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Language
            </label>
            <select
              value={selected.language}
              onChange={(e) =>
                // Clearing the name lets the sync effect refill the body text
                // for the newly picked language.
                onChange({
                  ...content,
                  templateLanguage: e.target.value,
                  templateName: "",
                })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              {matches.map((tpl) => (
                <option key={`${tpl.name}-${tpl.language}`} value={tpl.language}>
                  {tpl.language} — {tpl.status}
                </option>
              ))}
            </select>
          </div>
        )}

        {selected.header_text && (
          <div>
            <p className="mb-0.5 text-xs font-medium text-gray-600">Header</p>
            <p className="text-sm font-medium text-gray-900">
              {selected.header_text}
            </p>
          </div>
        )}
        <div>
          <p className="mb-0.5 text-xs font-medium text-gray-600">Body</p>
          <p className="whitespace-pre-wrap text-sm text-gray-900">
            {selected.body_text}
          </p>
        </div>
        {selected.footer_text && (
          <p className="text-xs text-gray-500">{selected.footer_text}</p>
        )}

        {(selected.variables || []).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-200/70 pt-3">
            <span className="text-xs font-medium text-gray-600">
              Fill in Template Variables below:
            </span>
            {selected.variables.map((v) => (
              <code
                key={`${v.component}-${v.index}`}
                className="rounded bg-white px-1.5 py-0.5 text-xs text-gray-700 ring-1 ring-gray-200"
              >
                {`{{${v.index}}}`}
                {v.component !== "BODY" && (
                  <span className="ml-1 text-gray-400">
                    {v.component === "BUTTON"
                      ? `${v.button_text || "button"} link`
                      : "header"}
                  </span>
                )}
              </code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Push / In-App Section ────────────────────────────────────────────────────

function PushSection({ content, onChange, showTitle = true, templates }) {
  return (
    <div className="space-y-3">
      {templates.length > 0 && (
        <TemplateSelector
          channel={content.channel}
          templates={templates}
          onSelect={(t) => onChange({ ...content, subject: t.title || "", body: t.body || "", templateId: t.id })}
        />
      )}
      {showTitle && (
        <div>
          <label className={labelCls}>Title</label>
          <input
            type="text"
            value={content.subject || ""}
            onChange={(e) => onChange({ ...content, subject: e.target.value })}
            placeholder="Fee reminder"
            className={inputCls}
          />
        </div>
      )}
      <div>
        <label className={labelCls}>Body</label>
        <textarea
          rows={4}
          value={content.body || ""}
          onChange={(e) => onChange({ ...content, body: e.target.value, format: "text" })}
          placeholder="Hi {{student_name}}, your fee of {{amount}} is due."
          className={`${inputCls} resize-y`}
        />
        <p className="mt-1 text-xs text-gray-400">
          Use <code className="rounded bg-gray-100 px-1">{"{{variable_name}}"}</code> for dynamic content.
        </p>
      </div>
    </div>
  );
}

// ─── Template Selector (from DB) ──────────────────────────────────────────────

function TemplateSelector({ channel, templates, onSelect }) {
  const [open, setOpen] = useState(false);
  const channelTemplates = templates.filter((t) => t.channel === channel);
  if (channelTemplates.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <Layers size={12} />
        Use existing template
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {channelTemplates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { onSelect(t); setOpen(false); }}
              className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-indigo-50 transition-colors border-b border-gray-50 last:border-0"
            >
              <span className="text-sm font-medium text-gray-900">{t.type}</span>
              <span className="text-xs text-gray-400 truncate">{t.title || t.body}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Notification Type Search ─────────────────────────────────────────────────

/** Group templates and configured aliases under their incoming type name. */
function buildTypeIndex(dbTemplates, waTemplates, aliases) {
  const waByName = new Map();
  for (const tpl of waTemplates) {
    const name = tpl.name || tpl.type;
    if (!name) continue;
    if (!waByName.has(name)) waByName.set(name, []);
    waByName.get(name).push(tpl);
  }

  const map = new Map();

  function entryFor(type) {
    if (!map.has(type)) {
      map.set(type, {
        type,
        channels: new Set(),
        waRows: [],
        preview: "",
        aliases: [],
      });
    }
    return map.get(type);
  }

  for (const tpl of dbTemplates) {
    if (!tpl.type) continue;
    const entry = entryFor(tpl.type);
    entry.channels.add(tpl.channel);
    if (!entry.preview) entry.preview = tpl.title || tpl.body || "";
  }

  for (const [name, rows] of waByName) {
    const entry = entryFor(name);
    entry.channels.add("whatsapp");
    entry.waRows.push(...rows);
    if (!entry.preview) entry.preview = rows[0].body_text || "";
  }

  // An alias wins on send, so the entry should describe the target template.
  for (const alias of aliases) {
    const entry = entryFor(alias.notification_type);
    entry.channels.add(alias.channel);
    entry.aliases.push(alias);
    if (alias.channel === "whatsapp") {
      const targetRows = waByName.get(alias.resolves_to) || [];
      entry.waRows = targetRows;
      entry.preview = targetRows[0]?.body_text || `Uses ${alias.resolves_to}`;
    }
  }

  return [...map.values()].map((entry) => ({
    ...entry,
    channels: CHANNELS.filter((c) => entry.channels.has(c.id)),
    // Only flag a status when nothing approved is available to send.
    waIssue: entry.waRows.some((row) => isApprovedStatus(row.status))
      ? null
      : entry.waRows[0] || null,
  }));
}

function TypeSearchField({
  value,
  onChange,
  dbTemplates,
  waTemplates,
  aliases,
  loading,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef(null);

  const entries = useMemo(
    () => buildTypeIndex(dbTemplates, waTemplates, aliases),
    [dbTemplates, waTemplates, aliases],
  );

  const results = useMemo(() => {
    return entries
      .map((entry) => ({ entry, score: matchScore(entry.type, value) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.type.localeCompare(b.entry.type))
      .slice(0, 8)
      .map((r) => r.entry);
  }, [entries, value]);

  // Results shrink as the query narrows, so keep the highlight in range.
  const highlighted = Math.min(activeIndex, Math.max(results.length - 1, 0));

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  function select(entry) {
    onChange(entry.type);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(highlighted + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(highlighted - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlighted]) select(results[highlighted]);
      else setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Search
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search or type — e.g. fee_due, class_reminder"
        autoComplete="off"
        className={`${inputCls} pl-8 ${value ? "pr-9" : ""}`}
      />
      {loading ? (
        <RefreshCw
          size={13}
          className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400"
        />
      ) : (
        value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setActiveIndex(0);
              setOpen(true);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={13} />
          </button>
        )
      )}

      {open && (
        <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400">
              {entries.length === 0
                ? "No templates yet — type any notification type to send."
                : "No matching template. This type will be sent as-is."}
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((entry, i) => (
                <li key={entry.type}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => select(entry)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      i === highlighted ? "bg-indigo-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {entry.type}
                      </p>
                      {entry.aliases.map((alias) => (
                        <p
                          key={`${alias.channel}-${alias.resolves_to}`}
                          className="flex items-center gap-1 truncate text-[11px] text-indigo-600"
                        >
                          <Link2 size={10} className="shrink-0" />
                          {channelLabel(alias.channel)} sends
                          <span className="truncate font-semibold">
                            {alias.resolves_to}
                          </span>
                        </p>
                      ))}
                      {entry.preview && (
                        <p className="truncate text-xs text-gray-400">
                          {entry.preview}
                        </p>
                      )}
                    </div>
                    {entry.waIssue && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${waStatusClass(
                          entry.waIssue.status,
                        )}`}
                      >
                        {entry.waIssue.status}
                      </span>
                    )}
                    <span className="flex shrink-0 items-center gap-1">
                      {entry.channels.map(({ id, label, Icon, color }) => (
                        <span
                          key={id}
                          aria-label={label}
                          className={`group/ch relative flex h-5 w-5 items-center justify-center rounded ${CHANNEL_COLORS[color].badge}`}
                        >
                          {createElement(Icon, { size: 11 })}
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute right-full top-1/2 z-30 mr-1.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-sm transition-opacity group-hover/ch:opacity-100"
                          >
                            {label}
                          </span>
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Variable Section ─────────────────────────────────────────────────────────

function VariableSection({ channelContents, selectedChannels, sharedVars, setSharedVars, perChannelVars, setPerChannelVars, useShared, setUseShared }) {
  // Collect all vars across selected channels (union)
  const allVars = [...new Set(
    selectedChannels.flatMap((ch) => extractVars(variableText(channelContents[ch]))),
  )];

  if (allVars.length === 0) return null;

  function handleSharedChange(key, value) {
    setSharedVars((prev) => ({ ...prev, [key]: value }));
  }

  function handlePerChannelChange(ch, key, value) {
    setPerChannelVars((prev) => ({
      ...prev,
      [ch]: { ...(prev[ch] || {}), [key]: value },
    }));
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-indigo-900">Template Variables</h3>
          <p className="text-xs text-indigo-600 mt-0.5">
            {allVars.length} variable{allVars.length > 1 ? "s" : ""} detected in your content
          </p>
        </div>
        <div className="flex rounded-lg border border-indigo-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setUseShared(true)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
              useShared ? "bg-indigo-600 text-white shadow-sm" : "text-indigo-600 hover:text-indigo-800"
            }`}
          >
            Shared
          </button>
          <button
            type="button"
            onClick={() => setUseShared(false)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
              !useShared ? "bg-indigo-600 text-white shadow-sm" : "text-indigo-600 hover:text-indigo-800"
            }`}
          >
            Per-channel
          </button>
        </div>
      </div>

      {useShared ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {allVars.map((key) => (
            <div key={key}>
              <label className="mb-1 block text-xs font-medium text-indigo-700">
                <code className="rounded bg-indigo-100 px-1.5 py-0.5">{`{{${key}}}`}</code>
              </label>
              <input
                type="text"
                value={sharedVars[key] || ""}
                onChange={(e) => handleSharedChange(key, e.target.value)}
                placeholder={`Value for {{${key}}}`}
                className={inputCls}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {selectedChannels.map((ch) => {
            const chVars = extractVars(variableText(channelContents[ch]));
            if (chVars.length === 0) return null;
            const channelCfg = CHANNELS.find((c) => c.id === ch);
            return (
              <div key={ch} className="rounded-lg border border-indigo-100 bg-white p-3 space-y-3">
                <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
                  {channelCfg && <channelCfg.Icon size={12} />}
                  {channelCfg?.label}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {chVars.map((key) => (
                    <div key={key}>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        <code className="rounded bg-gray-100 px-1.5">{`{{${key}}}`}</code>
                      </label>
                      <input
                        type="text"
                        value={perChannelVars[ch]?.[key] || ""}
                        onChange={(e) => handlePerChannelChange(ch, key, e.target.value)}
                        placeholder={`Value for {{${key}}}`}
                        className={inputCls}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Schedule Section ─────────────────────────────────────────────────────────

function ScheduleSection({ scheduleOpts, setScheduleOpts }) {
  const { enabled, type, runAt, frequency, timeOfDay, dayOfWeek, dayOfMonth, cronExpression, timezone } = scheduleOpts;

  function set(key, value) {
    setScheduleOpts((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
          <Clock size={16} className="text-amber-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-amber-900">Scheduled Send</h3>
          <p className="text-xs text-amber-600">Set a future time or recurring schedule</p>
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2">
          <div className="relative">
            <input type="checkbox" className="sr-only" checked={enabled} onChange={(e) => set("enabled", e.target.checked)} />
            <div className={`h-5 w-9 rounded-full transition-colors ${enabled ? "bg-amber-500" : "bg-gray-300"}`} />
            <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
          </div>
        </label>
      </div>

      {enabled && (
        <div className="space-y-4">
          {/* Type */}
          <div className="flex gap-3">
            {["one_time", "recurring"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("type", t)}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                  type === t ? "border-amber-400 bg-amber-100 text-amber-800" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t === "one_time" ? <Calendar size={14} /> : <Repeat size={14} />}
                {t === "one_time" ? "One-time" : "Recurring"}
              </button>
            ))}
          </div>

          {type === "one_time" && (
            <div>
              <label className={labelCls}>Date & Time</label>
              <input
                type="datetime-local"
                value={runAt}
                onChange={(e) => set("runAt", e.target.value)}
                className={inputCls}
                min={new Date().toISOString().slice(0, 16)}
              />
            </div>
          )}

          {type === "recurring" && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Frequency</label>
                  <select
                    value={frequency}
                    onChange={(e) => set("frequency", e.target.value)}
                    className={inputCls}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {f === "custom_cron" ? "Custom Cron" : f.charAt(0).toUpperCase() + f.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                {frequency !== "custom_cron" && (
                  <div>
                    <label className={labelCls}>Time of day</label>
                    <input type="time" value={timeOfDay} onChange={(e) => set("timeOfDay", e.target.value)} className={inputCls} />
                  </div>
                )}
              </div>

              {frequency === "weekly" && (
                <div>
                  <label className={labelCls}>Day of week</label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS_OF_WEEK.map((day, i) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => set("dayOfWeek", i)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                          dayOfWeek === i ? "bg-amber-500 text-white" : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {frequency === "monthly" && (
                <div>
                  <label className={labelCls}>Day of month</label>
                  <input type="number" min="1" max="28" value={dayOfMonth} onChange={(e) => set("dayOfMonth", parseInt(e.target.value, 10))} className={inputCls} />
                </div>
              )}

              {frequency === "custom_cron" && (
                <div>
                  <label className={labelCls}>Cron expression</label>
                  <input type="text" value={cronExpression} onChange={(e) => set("cronExpression", e.target.value)} placeholder="*/5 * * * *" className={`${inputCls} font-mono`} />
                </div>
              )}
            </div>
          )}

          <div>
            <label className={labelCls}>Timezone</label>
            <select value={timezone} onChange={(e) => set("timezone", e.target.value)} className={inputCls}>
              <option value="">UTC</option>
              {((() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC", "America/New_York", "Europe/London", "Asia/Kolkata"]; } })()).map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Audience Section ─────────────────────────────────────────────────────────

function AudienceSection({ recipientMode, setRecipientMode, singleUser, setSingleUser, selectedAudienceId, setSelectedAudienceId, audiences, loadingAudiences, waSessions, onManageAudience }) {
  const ownEntityId = waSessions[0]?.entity_id || "";

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-3 flex-wrap">
        {[
          { id: "single", label: "Single User", Icon: User },
          { id: "audience", label: "Audience", Icon: Users },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setRecipientMode(id)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all ${
              recipientMode === id
                ? "border-indigo-400 bg-indigo-600 text-white shadow-sm"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            {createElement(Icon, { size: 15 })}
            {label}
          </button>
        ))}
      </div>

      {recipientMode === "single" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>User ID <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={singleUser.user_id}
              onChange={(e) => setSingleUser((p) => ({ ...p, user_id: e.target.value }))}
              placeholder="user_123"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" value={singleUser.email} onChange={(e) => setSingleUser((p) => ({ ...p, email: e.target.value }))} placeholder="user@example.com" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Phone (E.164)</label>
            <input type="text" value={singleUser.phone} onChange={(e) => setSingleUser((p) => ({ ...p, phone: e.target.value }))} placeholder="+919876543210" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>FCM Token</label>
            <input type="text" value={singleUser.fcm_token} onChange={(e) => setSingleUser((p) => ({ ...p, fcm_token: e.target.value }))} placeholder="fcm-device-token" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>OneSignal Player ID</label>
            <input type="text" value={singleUser.onesignal_player_id} onChange={(e) => setSingleUser((p) => ({ ...p, onesignal_player_id: e.target.value }))} placeholder="abc-123-def" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Entity ID (WhatsApp)</label>
            <input
              type="text"
              value={singleUser.entity_id}
              onChange={(e) => setSingleUser((p) => ({ ...p, entity_id: e.target.value }))}
              placeholder="coaching_center_1"
              list="wa-entity-options"
              autoComplete="off"
              className={inputCls}
            />
            {waSessions.length > 0 && (
              <datalist id="wa-entity-options">
                {waSessions.map((session) => (
                  <option key={session.entity_id} value={session.entity_id}>
                    {session.phone_number || session.status}
                  </option>
                ))}
              </datalist>
            )}
            {ownEntityId && (
              <p className="mt-1 text-xs text-gray-400">
                {singleUser.entity_id === ownEntityId ? (
                  <>Your connected WhatsApp session — change it to send from another entity.</>
                ) : (
                  <>
                    Yours is{" "}
                    <button
                      type="button"
                      onClick={() =>
                        setSingleUser((p) => ({ ...p, entity_id: ownEntityId }))
                      }
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {ownEntityId}
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {recipientMode === "audience" && (
        <div>
          {loadingAudiences ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <RefreshCw size={14} className="animate-spin" /> Loading audiences…
            </div>
          ) : audiences.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-200 p-6 text-center">
              <Users size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500 mb-3">No audiences yet.</p>
              <button type="button" onClick={() => onManageAudience(null)} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
                Create audience
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={labelCls}>Select Audience</label>
                <button type="button" onClick={() => onManageAudience(null)} className="flex items-center gap-1 text-xs font-medium text-indigo-600">
                  <Plus size={12} /> Create audience
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {audiences.map((aud) => (
                  <button
                    key={aud.id}
                    type="button"
                    onClick={() => setSelectedAudienceId(aud.id)}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                      selectedAudienceId === aud.id
                        ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-400"
                        : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-100">
                      <Users size={14} className="text-indigo-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{aud.name}</p>
                      <p className="text-xs text-gray-400">{aud.member_count} member{aud.member_count !== 1 ? "s" : ""}</p>
                    </div>
                  </button>
                ))}
              </div>
              {selectedAudienceId && (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      onManageAudience(
                        audiences.find((aud) => aud.id === selectedAudienceId),
                      )
                    }
                    className="text-xs font-medium text-indigo-600 hover:underline"
                  >
                    Add, import, export, or edit members
                  </button>
                  <a
                    href={`/audiences/${selectedAudienceId}`}
                    className="text-xs font-medium text-gray-500 hover:underline"
                  >
                    Open audience page
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Channel Content Section ──────────────────────────────────────────────────

function ChannelContentSection({
  channel,
  content,
  onChange,
  dbTemplates,
  notifType,
  waTemplates,
  templateAliases,
  waLoading,
  waError,
  onReloadWaTemplates,
}) {
  const [expanded, setExpanded] = useState(true);
  const cfg = CHANNELS.find((c) => c.id === channel);
  const colors = CHANNEL_COLORS[cfg?.color || "blue"];

  return (
    <div className={`rounded-xl border bg-white overflow-hidden transition-all ${expanded ? "shadow-sm" : ""}`} style={{ borderColor: expanded ? colors.accent + "40" : "#e5e7eb" }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3.5"
      >
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${colors.badge}`}>
          {cfg && <cfg.Icon size={14} />}
        </span>
        <span className="flex-1 text-left text-sm font-semibold text-gray-800">{cfg?.label} Content</span>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4">
          {channel === "email" && (
            <EmailSection content={content} onChange={onChange} />
          )}
          {channel === "sms" && (
            <SmsSection content={content} onChange={onChange} templates={dbTemplates} />
          )}
          {channel === "whatsapp" && (
            <WhatsAppSection
              content={content}
              onChange={onChange}
              notifType={notifType}
              waTemplates={waTemplates}
              templateAliases={templateAliases}
              loading={waLoading}
              error={waError}
              onReload={onReloadWaTemplates}
            />
          )}
          {(channel === "push" || channel === "in_app") && (
            <PushSection content={content} onChange={onChange} showTitle={true} templates={dbTemplates} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main SendPage ────────────────────────────────────────────────────────────

export default function SendPage() {
  const [notifType, setNotifType] = useState("");
  const [selectedChannels, setSelectedChannels] = useState(["push"]);

  // Channel content map: { push: { subject, body, format }, email: {...}, ... }
  const [channelContents, setChannelContents] = useState({});

  // Recipient
  const [recipientMode, setRecipientMode] = useState("single"); // 'single' | 'audience'
  const [singleUser, setSingleUser] = useState({
    user_id: "", email: "", phone: "", fcm_token: "",
    onesignal_player_id: "", entity_id: "", parent_entity_id: "",
  });
  const [selectedAudienceId, setSelectedAudienceId] = useState("");
  const [audiences, setAudiences] = useState([]);
  const [loadingAudiences, setLoadingAudiences] = useState(false);
  const [managedAudience, setManagedAudience] = useState(undefined);

  // Variables
  const [useSharedVars, setUseSharedVars] = useState(true);
  const [sharedVars, setSharedVars] = useState({});
  const [perChannelVars, setPerChannelVars] = useState({});

  // Schedule
  const [scheduleOpts, setScheduleOpts] = useState({
    enabled: false,
    type: "one_time",
    runAt: "",
    frequency: "daily",
    timeOfDay: "09:00",
    dayOfWeek: 1,
    dayOfMonth: 1,
    cronExpression: "",
    timezone: "",
  });

  // DB templates (for existing template picker in email/sms/push)
  const [dbTemplates, setDbTemplates] = useState([]);
  const [waTemplates, setWaTemplates] = useState([]);
  const [templateAliases, setTemplateAliases] = useState([]);
  const [waSessions, setWaSessions] = useState([]);
  const [waLoading, setWaLoading] = useState(false);
  const [waError, setWaError] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const loadAudiences = useCallback(async () => {
    setLoadingAudiences(true);
    try {
      const response = await api.getAudiences();
      setAudiences(response.data || []);
    } finally {
      setLoadingAudiences(false);
    }
  }, []);

  // Load only audience metadata; members are fetched when managed.
  useEffect(() => {
    loadAudiences().catch(() => {});
  }, [loadAudiences]);

  // Load DB templates
  useEffect(() => {
    api.getTemplates({}).then((d) => setDbTemplates(d.data || [])).catch(() => {});
  }, []);

  // Default the Entity ID to the app's own connected WhatsApp session. The
  // field stays editable — this only prefills an empty value.
  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      try {
        const response = await api.listWhatsAppSessions("active");
        if (cancelled) return;
        const list = response.sessions || [];
        setWaSessions(list);
        const own = list[0];
        if (!own) return;
        setSingleUser((prev) =>
          prev.entity_id
            ? prev
            : {
                ...prev,
                entity_id: own.entity_id,
                parent_entity_id:
                  prev.parent_entity_id || own.parent_entity_id || "",
              },
        );
      } catch {
        if (!cancelled) setWaSessions([]);
      }
    }
    loadSessions();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load WhatsApp templates synced from Meta (cache only — Meta itself is slow)
  const loadWaTemplates = useCallback(async () => {
    setWaLoading(true);
    setWaError("");
    try {
      const entityId = singleUser.entity_id.trim() || undefined;
      const [d, aliasResponse] = await Promise.all([
        api.getWhatsAppTemplates({
          entityId,
          source: "cache",
          status: "ALL",
        }),
        api.getTemplateAliases({ entityId }),
      ]);
      setWaTemplates(d.data || []);
      setTemplateAliases(aliasResponse.data || []);
    } catch (err) {
      setWaError(err.message);
      setWaTemplates([]);
    } finally {
      setWaLoading(false);
    }
  }, [singleUser.entity_id]);

  useEffect(() => {
    loadWaTemplates();
  }, [loadWaTemplates]);

  // Aliases that apply to the type currently typed, for any channel.
  const activeAliases = useMemo(
    () =>
      templateAliases.filter(
        (alias) =>
          normalizeSearchText(alias.notification_type) ===
          normalizeSearchText(notifType),
      ),
    [templateAliases, notifType],
  );

  function toggleChannel(ch) {
    setSelectedChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  }

  function updateChannelContent(ch, content) {
    setChannelContents((prev) => ({ ...prev, [ch]: { ...content, channel: ch } }));
  }

  /**
   * /notify takes a single variables object, so per-channel values are merged.
   * WhatsApp placeholders are positional ({{1}}, {{2}}) and go out as the
   * `whatsapp` array, keeping them clear of the other channels' named values.
   */
  function buildVariablesPayload() {
    const named = {};
    const positional = {};

    function absorb(vars) {
      for (const [key, value] of Object.entries(vars || {})) {
        if (/^\d+$/.test(key)) positional[key] = value;
        else named[key] = value;
      }
    }

    if (useSharedVars) absorb(sharedVars);
    else for (const ch of selectedChannels) absorb(perChannelVars[ch]);

    const indexes = Object.keys(positional).map(Number);
    if (indexes.length > 0) {
      const highest = Math.max(...indexes);
      named.whatsapp = Array.from({ length: highest }, (_, i) =>
        String(positional[String(i + 1)] ?? ""),
      );
    }

    const waLanguage = channelContents.whatsapp?.templateLanguage;
    if (selectedChannels.includes("whatsapp") && waLanguage) {
      named.whatsapp_language = waLanguage;
    }

    return named;
  }

  /** Meta rejects a template send outright when a {{n}} value is blank. */
  function missingWhatsAppParams() {
    const waContent = channelContents.whatsapp;
    if (!selectedChannels.includes("whatsapp") || !waContent?.templateName) {
      return [];
    }
    const values = buildVariablesPayload().whatsapp || [];
    return extractVars(variableText(waContent))
      .filter((key) => /^\d+$/.test(key))
      .filter((key) => !String(values[Number(key) - 1] ?? "").trim());
  }

  async function handleSend(e) {
    e.preventDefault();

    if (!notifType.trim()) {
      toast.error("Notification Type is required");
      return;
    }
    if (selectedChannels.length === 0) {
      toast.error("Select at least one channel");
      return;
    }
    if (recipientMode === "single" && !singleUser.user_id.trim()) {
      toast.error("User ID is required for single-user sends");
      return;
    }
    if (recipientMode === "audience" && !selectedAudienceId) {
      toast.error("Select an audience");
      return;
    }
    const missingWaParams = missingWhatsAppParams();
    if (missingWaParams.length > 0) {
      toast.error(
        `WhatsApp template needs a value for ${missingWaParams
          .map((key) => `{{${key}}}`)
          .join(", ")}`,
      );
      return;
    }

    setSending(true);
    setResult(null);

    try {
      if (scheduleOpts.enabled) {
        await handleScheduledSend();
      } else {
        await handleImmediateSend();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleImmediateSend() {
    if (recipientMode === "audience") {
      const response = await api.notifyAudience(selectedAudienceId, {
        type: notifType.trim(),
        channels: selectedChannels,
        variables: buildVariablesPayload(),
        entity_id: singleUser.entity_id.trim() || undefined,
        parent_entity_id: singleUser.parent_entity_id.trim() || undefined,
      });
      setResult(response);
      toast.success(
        `Broadcast queued for ${response.queued} member${response.queued === 1 ? "" : "s"}${response.skipped ? `; ${response.skipped} skipped` : ""}`,
      );
    } else {
      // Single user
      const userObj = {};
      if (singleUser.email.trim()) userObj.email = singleUser.email.trim();
      if (singleUser.phone.trim()) userObj.phone = singleUser.phone.trim();
      if (singleUser.fcm_token.trim()) userObj.fcm_token = singleUser.fcm_token.trim();
      if (singleUser.onesignal_player_id.trim()) userObj.onesignal_player_id = singleUser.onesignal_player_id.trim();

      const vars = buildVariablesPayload();

      const payload = {
        user_id: singleUser.user_id.trim(),
        type: notifType.trim(),
        channels: selectedChannels,
        variables: Object.keys(vars).length > 0 ? vars : undefined,
        user: userObj,
        entity_id: singleUser.entity_id.trim() || undefined,
        parent_entity_id: singleUser.parent_entity_id.trim() || undefined,
      };

      const data = await api.sendNotification(payload);
      setResult({ ...data, broadcast: false });
      toast.success("Notification enqueued!");
    }
  }

  async function handleScheduledSend() {
    // Build audience object for the schedule
    let audiencePayload = {};

    if (recipientMode === "audience") {
      const audData = await api.getAudience(selectedAudienceId);
      const members = audData.data?.members || [];
      audiencePayload = { members };
    } else {
      const userObj = {
        user_id: singleUser.user_id.trim(),
        ...(singleUser.email.trim() ? { email: singleUser.email.trim() } : {}),
        ...(singleUser.phone.trim() ? { phone: singleUser.phone.trim() } : {}),
        ...(singleUser.fcm_token.trim() ? { fcm_token: singleUser.fcm_token.trim() } : {}),
      };
      audiencePayload = { members: [userObj] };
    }

    const vars = buildVariablesPayload();

    const schedulePayload = {
      type: scheduleOpts.type,
      template_key: notifType.trim(),
      audience: audiencePayload,
      data_source_url: "",
      data_source_secret: "",
      timezone: scheduleOpts.timezone || "UTC",
      ...(scheduleOpts.type === "one_time"
        ? { run_at: new Date(scheduleOpts.runAt).toISOString() }
        : {
            frequency: scheduleOpts.frequency,
            time_of_day: scheduleOpts.timeOfDay,
            ...(scheduleOpts.frequency === "weekly" ? { day_of_week: scheduleOpts.dayOfWeek } : {}),
            ...(scheduleOpts.frequency === "monthly" ? { day_of_month: scheduleOpts.dayOfMonth } : {}),
            ...(scheduleOpts.frequency === "custom_cron" ? { cron_expression: scheduleOpts.cronExpression } : {}),
          }),
    };

    if (Object.keys(vars).length > 0) {
      schedulePayload.variables = vars;
    }

    const data = await api.createSchedule(schedulePayload);
    setResult({ scheduled: true, schedule_id: data.data?.id });
    toast.success("Schedule created!");
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Send size={20} className="text-indigo-600" />
          Send Notification
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Compose and send across channels — to a single user or a named audience
        </p>
      </div>

      <form onSubmit={handleSend} className="space-y-5">
        {/* ─ Notification Type ─ */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div>
            <label className={labelCls}>
              Notification Type <span className="text-red-500">*</span>
            </label>
            <TypeSearchField
              value={notifType}
              onChange={setNotifType}
              dbTemplates={dbTemplates}
              waTemplates={waTemplates}
              aliases={templateAliases}
              loading={waLoading}
            />
            {activeAliases.length > 0 ? (
              <div className="mt-2 space-y-1 rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2">
                {activeAliases.map((alias) => (
                  <p
                    key={`${alias.channel}-${alias.resolves_to}`}
                    className="flex flex-wrap items-center gap-1.5 text-xs text-indigo-800"
                  >
                    <Link2 size={11} className="shrink-0" />
                    <span className="font-medium">
                      {channelLabel(alias.channel)}
                    </span>
                    sends
                    <code className="rounded bg-white px-1.5 py-0.5 font-semibold">
                      {alias.resolves_to}
                    </code>
                    <span className="text-indigo-500">
                      instead of {alias.notification_type}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}
            <p className="mt-1 text-xs text-gray-400">
              Matches the <code className="rounded bg-gray-100 px-1">type</code> field in your templates and the WhatsApp template name synced from Meta.
            </p>
          </div>
        </div>

        {/* ─ Recipient ─ */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <User size={16} className="text-indigo-500" />
            Recipient
          </h3>
          <AudienceSection
            recipientMode={recipientMode}
            setRecipientMode={setRecipientMode}
            singleUser={singleUser}
            setSingleUser={setSingleUser}
            selectedAudienceId={selectedAudienceId}
            setSelectedAudienceId={setSelectedAudienceId}
            audiences={audiences}
            loadingAudiences={loadingAudiences}
            waSessions={waSessions}
            onManageAudience={setManagedAudience}
          />
        </div>

        {/* ─ Channels ─ */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Zap size={16} className="text-indigo-500" />
            Channels <span className="text-red-500">*</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map(({ id, label, Icon, color }) => {
              const active = selectedChannels.includes(id);
              const colors = CHANNEL_COLORS[color];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleChannel(id)}
                  className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                    active ? colors.pill : colors.off
                  }`}
                >
                  {createElement(Icon, { size: 13 })}
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─ Per-channel content ─ */}
        {selectedChannels.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 px-1">
              <Edit3 size={15} className="text-indigo-500" />
              Channel Content
            </h3>
            {selectedChannels.map((ch) => (
              <ChannelContentSection
                key={ch}
                channel={ch}
                content={channelContents[ch] || {}}
                onChange={(c) => updateChannelContent(ch, c)}
                dbTemplates={dbTemplates}
                notifType={notifType}
                waTemplates={waTemplates}
                templateAliases={templateAliases}
                waLoading={waLoading}
                waError={waError}
                onReloadWaTemplates={loadWaTemplates}
              />
            ))}
          </div>
        )}

        {/* ─ Variables ─ */}
        <VariableSection
          channelContents={channelContents}
          selectedChannels={selectedChannels}
          sharedVars={sharedVars}
          setSharedVars={setSharedVars}
          perChannelVars={perChannelVars}
          setPerChannelVars={setPerChannelVars}
          useShared={useSharedVars}
          setUseShared={setUseSharedVars}
        />

        {/* ─ Schedule ─ */}
        <ScheduleSection scheduleOpts={scheduleOpts} setScheduleOpts={setScheduleOpts} />

        {/* ─ Submit ─ */}
        <button
          type="submit"
          disabled={sending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : scheduleOpts.enabled ? (
            <Clock size={16} />
          ) : (
            <Send size={16} />
          )}
          {sending
            ? "Processing…"
            : scheduleOpts.enabled
              ? "Create Schedule"
              : recipientMode === "audience"
                ? "Broadcast to Audience"
                : "Send Notification"}
        </button>
      </form>

      <AudienceManager
        isOpen={managedAudience !== undefined}
        audience={managedAudience || null}
        onClose={() => setManagedAudience(undefined)}
        onSaved={loadAudiences}
        onSelect={(audience) => setSelectedAudienceId(audience.id)}
      />

      {/* ─ Result ─ */}
      {result && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 space-y-2">
          {result.scheduled ? (
            <>
              <p className="text-sm font-semibold text-green-800 flex items-center gap-2">
                <Clock size={14} /> Schedule created successfully
              </p>
              <p className="text-xs text-green-600 font-mono">ID: {result.schedule_id}</p>
            </>
          ) : result.broadcast ? (
            <>
              <p className="text-sm font-semibold text-green-800 flex items-center gap-2">
                <Users size={14} /> Broadcast queued
              </p>
              <div className="flex gap-4 text-sm">
                <span className="text-green-700">{result.queued} queued</span>
                {result.skipped > 0 && <span className="text-amber-600">{result.skipped} skipped</span>}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-green-800 flex items-center gap-2">
                <Send size={14} /> Notification enqueued
              </p>
              <div className="space-y-1 text-sm">
                <div className="flex gap-2">
                  <span className="font-medium text-green-700">ID:</span>
                  <span className="font-mono text-xs text-green-600">{result.notification_id}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-medium text-green-700">Channels:</span>
                  <span className="text-green-600">{(result.channels_enqueued || []).join(", ")}</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
