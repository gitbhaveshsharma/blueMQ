import {
  WHATSAPP_TEMPLATE_CATEGORIES,
  WHATSAPP_TEMPLATE_LANGUAGES,
} from "../../config/templateChannels";
import { parseWhatsAppEditorJson } from "../../utils/whatsappTemplateEditor";

function envelopeFromFields({ headerText, body, footerText, buttons }) {
  const components = [];
  if (headerText?.trim()) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: headerText.trim(),
    });
  }
  components.push({ type: "BODY", text: body || "" });
  if (footerText?.trim()) {
    components.push({ type: "FOOTER", text: footerText.trim() });
  }
  if (Array.isArray(buttons) && buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons });
  }
  return { components };
}

function fieldsFromComponents(components) {
  const list = Array.isArray(components) ? components : [];
  const header = list.find((c) => c.type === "HEADER");
  const body = list.find((c) => c.type === "BODY");
  const footer = list.find((c) => c.type === "FOOTER");
  const buttons = list.find((c) => c.type === "BUTTONS");
  return {
    headerText: header?.text || "",
    body: body?.text || "",
    footerText: footer?.text || "",
    buttons: buttons?.buttons || [],
  };
}

export default function WhatsAppTemplateEditor({
  form,
  onChange,
  isEditing,
}) {
  function update(partial) {
    onChange({ ...form, ...partial });
  }

  function handleFormatChange(nextFormat) {
    if (nextFormat === form.body_format) return;
    if (nextFormat === "json") {
      const envelope = envelopeFromFields(form);
      update({
        body_format: "json",
        jsonText: JSON.stringify(envelope, null, 2),
      });
      return;
    }
    try {
      const { components } = parseWhatsAppEditorJson(form.jsonText || "{}");
      update({
        body_format: "text",
        ...fieldsFromComponents(components),
      });
    } catch {
      update({ body_format: "text" });
    }
  }

  function addButton() {
    update({
      buttons: [
        ...(form.buttons || []),
        { type: "QUICK_REPLY", text: "" },
      ],
    });
  }

  function updateButton(index, partial) {
    const next = [...(form.buttons || [])];
    next[index] = { ...next[index], ...partial };
    update({ buttons: next });
  }

  function removeButton(index) {
    update({
      buttons: (form.buttons || []).filter((_, i) => i !== index),
    });
  }

  const languageOptions = WHATSAPP_TEMPLATE_LANGUAGES.some(
    (item) => item.id === form.language,
  )
    ? WHATSAPP_TEMPLATE_LANGUAGES
    : form.language
      ? [
          { id: form.language, label: form.language },
          ...WHATSAPP_TEMPLATE_LANGUAGES,
        ]
      : WHATSAPP_TEMPLATE_LANGUAGES;

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Template name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.type}
            onChange={(e) =>
              update({ type: e.target.value.toLowerCase().replace(/\s+/g, "_") })
            }
            placeholder="otp_template"
            disabled={isEditing}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50 disabled:text-gray-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Meta name: lowercase letters, numbers, underscores.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Language <span className="text-red-500">*</span>
          </label>
          <select
            value={form.language}
            onChange={(e) => update({ language: e.target.value })}
            disabled={isEditing}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50"
          >
            <option value="">Select language</option>
            {languageOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Category <span className="text-red-500">*</span>
          </label>
          <select
            value={form.category}
            onChange={(e) => update({ category: e.target.value })}
            disabled={isEditing}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-gray-50"
          >
            <option value="">Select category</option>
            {WHATSAPP_TEMPLATE_CATEGORIES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Mode
          </label>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => handleFormatChange("text")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                form.body_format === "text"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-gray-600"
              }`}
            >
              Plain text
            </button>
            <button
              type="button"
              onClick={() => handleFormatChange("json")}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                form.body_format === "json"
                  ? "bg-white text-indigo-600 shadow-sm"
                  : "text-gray-600"
              }`}
            >
              JSON
            </button>
          </div>
        </div>
      </div>

      {form.body_format === "json" ? (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Components JSON <span className="text-red-500">*</span>
          </label>
          <textarea
            value={form.jsonText}
            onChange={(e) => update({ jsonText: e.target.value })}
            rows={16}
            spellCheck={false}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
      ) : (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Header (optional)
            </label>
            <input
              type="text"
              value={form.headerText}
              onChange={(e) => update({ headerText: e.target.value })}
              placeholder="Header text"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Body <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.body}
              onChange={(e) => update({ body: e.target.value })}
              rows={8}
              placeholder="Hello {{1}}, your code is {{2}}"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <p className="mt-1 text-xs text-gray-400">
              Use positional placeholders {"{{1}}"}, {"{{2}}"} for Meta variables.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Footer (optional)
            </label>
            <input
              type="text"
              value={form.footerText}
              onChange={(e) => update({ footerText: e.target.value })}
              placeholder="Footer"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Buttons</label>
              <button
                type="button"
                onClick={addButton}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                Add button
              </button>
            </div>
            <div className="space-y-2">
              {(form.buttons || []).map((button, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select
                    value={button.type}
                    onChange={(e) => updateButton(index, { type: e.target.value })}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="QUICK_REPLY">Quick reply</option>
                    <option value="URL">URL</option>
                    <option value="PHONE_NUMBER">Phone</option>
                  </select>
                  <input
                    type="text"
                    value={button.text || ""}
                    onChange={(e) => updateButton(index, { text: e.target.value })}
                    placeholder="Button text"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  {button.type === "URL" ? (
                    <input
                      type="text"
                      value={button.url || ""}
                      onChange={(e) => updateButton(index, { url: e.target.value })}
                      placeholder="https://"
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  ) : button.type === "PHONE_NUMBER" ? (
                    <input
                      type="text"
                      value={button.phone_number || ""}
                      onChange={(e) =>
                        updateButton(index, { phone_number: e.target.value })
                      }
                      placeholder="+91..."
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeButton(index)}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
