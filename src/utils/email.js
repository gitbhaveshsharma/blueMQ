function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeBodyFormat(value) {
  return value === "html" ? "html" : "text";
}

function buildEmailHtml({ body, ctaText, actionUrl, bodyFormat }) {
  const format = normalizeBodyFormat(bodyFormat);
  const safeCtaText = escapeHtml(ctaText ?? "");
  const safeActionUrl = escapeHtml(actionUrl ?? "");

  const ctaBlock =
    ctaText && actionUrl
      ? `<p style="margin: 24px 0 0;"><a href="${safeActionUrl}" style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600;">${safeCtaText}</a></p>`
      : "";

  const bodyMarkup =
    format === "html"
      ? `<div style="line-height: 1.5;">${body || ""}</div>`
      : `<p style="margin: 0; white-space: pre-line; line-height: 1.5;">${escapeHtml(
          body ?? "",
        )}</p>`;

  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111827;">
      ${bodyMarkup}
      ${ctaBlock}
    </div>
  `;
}

module.exports = { buildEmailHtml, escapeHtml };
