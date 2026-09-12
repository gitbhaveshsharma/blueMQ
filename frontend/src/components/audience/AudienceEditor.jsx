import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../services/api";
import {
  AUDIENCE_MEMBER_FIELDS,
  EMPTY_AUDIENCE_MEMBER,
  hasAudienceDeliveryAddress,
} from "../../config/audienceMembers";

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";
const PAGE_SIZE = 50;
const IMPORT_COLUMNS = AUDIENCE_MEMBER_FIELDS.map((field) => field.key).join(
  ", ",
);

function MemberFields({ value, onChange }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {AUDIENCE_MEMBER_FIELDS.map((field) => (
        <label key={field.key} className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">
            {field.label}
          </span>
          <input
            type={field.type}
            value={value[field.key] || ""}
            onChange={(event) =>
              onChange({ ...value, [field.key]: event.target.value })
            }
            placeholder={field.placeholder}
            className={inputCls}
          />
        </label>
      ))}
    </div>
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Audience details + member management. Rendered both inside the right-side
 * sheet and on the dedicated audience page, so the two never drift apart.
 */
export default function AudienceEditor({ audience, onSaved, onSelect }) {
  const [current, setCurrent] = useState(audience || null);
  const [name, setName] = useState(audience?.name || "");
  const [description, setDescription] = useState(audience?.description || "");
  const [members, setMembers] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pages: 1,
    total: audience?.member_count || 0,
  });
  const [memberDraft, setMemberDraft] = useState({ ...EMPTY_AUDIENCE_MEMBER });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const currentId = current?.id || null;

  const loadMembers = useCallback(
    async (page = 1) => {
      if (!currentId) return;
      setLoading(true);
      try {
        const response = await api.getAudienceMembers(currentId, {
          page,
          limit: PAGE_SIZE,
        });
        setMembers(response.data || []);
        setPagination(response.pagination);
      } catch (error) {
        toast.error(error.message);
      } finally {
        setLoading(false);
      }
    },
    [currentId],
  );

  useEffect(() => {
    loadMembers(1);
  }, [loadMembers]);

  async function saveAudience() {
    if (!name.trim()) {
      toast.error("Audience name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
      };
      const response = currentId
        ? await api.updateAudience(currentId, payload)
        : await api.createAudience(payload);
      setCurrent(response.data);
      onSaved?.(response.data);
      onSelect?.(response.data);
      toast.success(currentId ? "Audience updated" : "Audience created");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveMember() {
    if (!hasAudienceDeliveryAddress(memberDraft)) {
      toast.error("Enter at least one delivery address");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.updateAudienceMember(currentId, editingId, memberDraft);
        toast.success("Member updated");
      } else {
        await api.addAudienceMember(currentId, memberDraft);
        toast.success("Member added");
      }
      setMemberDraft({ ...EMPTY_AUDIENCE_MEMBER });
      setEditingId(null);
      await loadMembers(editingId ? pagination.page : 1);
      onSaved?.(current);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(memberId) {
    try {
      await api.deleteAudienceMember(currentId, memberId);
      await loadMembers(pagination.page);
      onSaved?.(current);
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function importFile(file) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "json"].includes(extension)) {
      toast.error("Choose a CSV or JSON file");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setImporting(true);
    try {
      const result = await api.importAudienceMembers(currentId, { file });
      toast.success(
        `Imported ${result.imported}; skipped ${result.skipped || 0}`,
      );
      await loadMembers(1);
      onSaved?.(current);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function exportMembers(format) {
    try {
      const blob = await api.exportAudienceMembers(currentId, format);
      downloadBlob(blob, `audience-${currentId}.${format}`);
    } catch (error) {
      toast.error(error.message);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600">
            Audience name *
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600">
            Description
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </label>
        <button
          type="button"
          onClick={saveAudience}
          disabled={saving}
          className="flex w-fit items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {currentId ? "Save details" : "Create and add members"}
        </button>
      </section>

      {currentId && (
        <>
          <section className="rounded-xl border border-gray-200 p-4">
            <h4 className="mb-3 text-sm font-semibold text-gray-800">
              {editingId ? "Edit member" : "Add member"}
            </h4>
            <MemberFields value={memberDraft} onChange={setMemberDraft} />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={saveMember}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Plus size={13} />
                {editingId ? "Save member" : "Add member"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setMemberDraft({ ...EMPTY_AUDIENCE_MEMBER });
                  }}
                  className="rounded-lg border px-3 py-2 text-xs"
                >
                  Cancel
                </button>
              )}
            </div>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-gray-800">
                Members ({pagination.total})
              </h4>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(event) => importFile(event.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={importing}
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"
                >
                  {importing ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    <Upload size={12} />
                  )}{" "}
                  Import
                </button>
                <button
                  type="button"
                  onClick={() => exportMembers("csv")}
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"
                >
                  <Download size={12} /> CSV
                </button>
                <button
                  type="button"
                  onClick={() => exportMembers("json")}
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs"
                >
                  <Download size={12} /> JSON
                </button>
              </div>
            </div>
            <p className="mb-3 text-xs text-gray-400">
              Columns: {IMPORT_COLUMNS}
            </p>

            {loading ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="animate-spin text-indigo-500" />
              </div>
            ) : members.length === 0 ? (
              <p className="rounded-xl border border-dashed py-8 text-center text-sm text-gray-400">
                No members yet.
              </p>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-800">
                        {member.email || member.phone || member.user_id}
                      </p>
                      <p className="truncate text-xs text-gray-400">
                        {[member.phone, member.entity_id]
                          .filter(Boolean)
                          .join(" · ") || "Token recipient"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(member.id);
                        setMemberDraft({
                          ...EMPTY_AUDIENCE_MEMBER,
                          ...member,
                        });
                      }}
                      className="text-xs font-medium text-indigo-600"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMember(member.id)}
                      className="rounded p-1 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {pagination.pages > 1 && (
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => loadMembers(pagination.page - 1)}
                  className="rounded border p-1.5 disabled:opacity-40"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-gray-500">
                  {pagination.page} / {pagination.pages}
                </span>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.pages}
                  onClick={() => loadMembers(pagination.page + 1)}
                  className="rounded border p-1.5 disabled:opacity-40"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
