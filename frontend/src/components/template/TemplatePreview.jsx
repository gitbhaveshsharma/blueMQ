import { useState } from "react";
import { getTemplateChannelConfig } from "../../config/templateChannels";

const CHAT_TONE_CLASSES = {
  sms: "bg-gray-100 text-gray-700",
  whatsapp: "bg-green-100 text-green-800",
};

// ─── Device configs ───────────────────────────────────────────────────────────
const DEVICES = [
  {
    id: "mobile",
    label: "Mobile",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <circle cx="12" cy="18.5" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    ),
    frameClass: "w-[375px]",
    iframeHeight: "h-[520px]",
  },
  {
    id: "tablet",
    label: "Tablet",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
        <rect x="3" y="2" width="18" height="20" rx="2" />
        <circle cx="12" cy="19" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    ),
    frameClass: "w-[600px]",
    iframeHeight: "h-[560px]",
  },
  {
    id: "desktop",
    label: "Desktop",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" strokeLinecap="round" />
      </svg>
    ),
    frameClass: "w-full",
    iframeHeight: "h-[620px]",
  },
];

// ─── Email doc builder ────────────────────────────────────────────────────────
function buildEmailPreviewDoc(html) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px 20px;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 15px;
        line-height: 1.65;
        color: #1a1a1a;
        background: #ffffff;
      }
      img { max-width: 100%; height: auto; display: block; }
      a { color: #2563eb; text-decoration: underline; }
      p { margin: 0 0 1em; }
      h1,h2,h3 { font-family: inherit; margin: 0 0 .6em; line-height: 1.25; }
    </style>
  </head>
  <body>${html || ""}</body>
</html>`;
}

// ─── PreviewCard ──────────────────────────────────────────────────────────────
function PreviewCard({ title, body, ctaText, actionUrl }) {
  const hasTitle = Boolean(title?.trim());
  const hasBody = Boolean(body?.trim());

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className={hasTitle ? "text-sm font-semibold text-gray-900" : "text-sm font-semibold text-gray-400 italic"}>
        {hasTitle ? title : "No title yet"}
      </div>
      <div className={hasBody ? "mt-2 text-sm text-gray-600 whitespace-pre-wrap" : "mt-2 text-sm text-gray-400 italic"}>
        {hasBody ? body : "No body yet"}
      </div>
      {ctaText && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white">
          <span>{ctaText}</span>
          {actionUrl && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wide">Link</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PreviewChat ──────────────────────────────────────────────────────────────
function PreviewChat({ body, tone }) {
  const hasBody = Boolean(body?.trim());
  const toneClass = CHAT_TONE_CLASSES[tone] || CHAT_TONE_CLASSES.sms;

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

// ─── PreviewEmail (main upgrade) ─────────────────────────────────────────────
function PreviewEmail({ title, body, bodyFormat, ctaText, actionUrl }) {
  const [activeDevice, setActiveDevice] = useState("desktop");

  const hasTitle = Boolean(title?.trim());
  const hasBody = Boolean(body?.trim());
  const isHtml = bodyFormat === "html";

  const device = DEVICES.find((d) => d.id === activeDevice) ?? DEVICES[2];

  // Fake "from" meta for realism
  const senderInitial = "M";
  const senderName = "MentoraCity";
  const senderEmail = "noreply@mentoracity.com";
  const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      {/* ── Inbox-style header bar ── */}
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
        {/* Traffic lights */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="w-3 h-3 rounded-full bg-red-400" />
          <span className="w-3 h-3 rounded-full bg-yellow-400" />
          <span className="w-3 h-3 rounded-full bg-green-400" />
        </div>

        {/* Subject line */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {/* Avatar */}
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold">
              {senderInitial}
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-semibold truncate ${hasTitle ? "text-gray-900" : "text-gray-400 italic"}`}>
                {hasTitle ? title : "No subject yet"}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                <span className="font-medium text-gray-700">{senderName}</span>
                {" "}
                <span className="text-gray-400">&lt;{senderEmail}&gt;</span>
              </p>
            </div>
          </div>
          <span className="flex-shrink-0 text-xs text-gray-400 mt-0.5">{nowStr}</span>
        </div>

        {/* Action row: Reply, Forward, etc. */}
        <div className="flex items-center gap-2 mt-3">
          {["Reply", "Forward"].map((action) => (
            <button
              key={action}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors cursor-default"
            >
              {action === "Reply" ? (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M6.78 1.97a.75.75 0 0 1 0 1.06L3.81 6h6.44A5.75 5.75 0 0 1 16 11.75v.5a.75.75 0 0 1-1.5 0v-.5A4.25 4.25 0 0 0 10.25 7.5H3.81l2.97 2.97a.75.75 0 1 1-1.06 1.06L1.47 7.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" />
                </svg>
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M9.22 1.97a.75.75 0 0 0 0 1.06L12.19 6H5.75A5.75 5.75 0 0 0 0 11.75v.5a.75.75 0 0 0 1.5 0v-.5A4.25 4.25 0 0 1 5.75 7.5h6.44l-2.97 2.97a.75.75 0 1 0 1.06 1.06l4.25-4.25a.75.75 0 0 0 0-1.06L10.28 1.97a.75.75 0 0 0-1.06 0Z" />
                </svg>
              )}
              {action}
            </button>
          ))}
        </div>
      </div>

      {/* ── Device switcher ── */}
      <div className="flex items-center justify-center gap-1 border-b border-gray-100 bg-gray-50 px-4 py-2">
        {DEVICES.map((d) => (
          <button
            key={d.id}
            onClick={() => setActiveDevice(d.id)}
            title={d.label}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              activeDevice === d.id
                ? "bg-gray-900 text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {d.icon}
            <span>{d.label}</span>
          </button>
        ))}
      </div>

      {/* ── Email body viewport ── */}
      <div className="bg-[#f3f4f6] p-4 flex justify-center overflow-x-auto">
        <div
          className={`transition-all duration-300 ${device.frameClass} overflow-hidden`}
        >
          {isHtml ? (
            hasBody ? (
              <iframe
                title="Email HTML preview"
                sandbox=""
                className={`w-full ${device.iframeHeight} block`}
                srcDoc={buildEmailPreviewDoc(body)}
              />
            ) : (
              <div className={`flex items-center justify-center ${device.iframeHeight} text-sm text-gray-400 italic`}>
                No body yet
              </div>
            )
          ) : hasBody ? (
            <div className={`${device.iframeHeight} overflow-y-auto px-5 py-5 text-sm text-gray-700 whitespace-pre-wrap`}>
              {body}
            </div>
          ) : (
            <div className={`flex items-center justify-center ${device.iframeHeight} text-sm text-gray-400 italic`}>
              No body yet
            </div>
          )}

          {/* CTA button inside email body */}
          {ctaText && (
            <div className="px-5 pb-5">
              <div className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2 text-xs font-semibold text-white">
                <span>{ctaText}</span>
                {actionUrl && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wide">Link</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Renderer map ─────────────────────────────────────────────────────────────
const PREVIEW_RENDERERS = {
  card: PreviewCard,
  chat: PreviewChat,
  email: PreviewEmail,
};

// ─── TemplatePreview (root export) ───────────────────────────────────────────
export default function TemplatePreview({
  channel,
  title,
  body,
  bodyFormat,
  ctaText,
  actionUrl,
}) {
  const channelConfig = getTemplateChannelConfig(channel);
  const PreviewRenderer = PREVIEW_RENDERERS[channelConfig.previewType] || PreviewCard;

  return (
    <div >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Preview</span>
        <span className="text-xs text-gray-400">{channelConfig.label}</span>
      </div>

      <PreviewRenderer
        title={title}
        body={body}
        bodyFormat={bodyFormat}
        ctaText={ctaText}
        actionUrl={actionUrl}
        tone={channelConfig.previewTone}
      />

      {ctaText && !actionUrl && (
        <p className="mt-3 text-xs text-amber-600">
          CTA text is set without a link. Add CTA Link here or pass action_url when calling /notify.
        </p>
      )}
    </div>
  );
}