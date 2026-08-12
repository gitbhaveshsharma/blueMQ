import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";
import toast from "react-hot-toast";
import {
  Users,
  Plus,
  Trash2,
  Pencil,
  X,
  RefreshCw,
  User,
  Mail,
  Phone,
  Save,
  ChevronDown,
  ChevronUp,
  Search,
  Download,
  Upload,
} from "lucide-react";

// ─── Constants & Helpers ─────────────────────────────────────────────────────

const EMPTY_MEMBER = {
  name: "",
  email: "",
  phone: "",
  user_id: "",
  fcm_token: "",
  onesignal_player_id: "",
};

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all";
const labelCls = "mb-1 block text-xs font-medium text-gray-600";

// ─── Member Row ───────────────────────────────────────────────────────────────

function MemberRow({ member, index, onChange, onRemove, expanded, onToggle }) {
  const hasData = member.name || member.email || member.phone;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          {hasData ? (
            <p className="text-sm font-medium text-gray-800 truncate">
              {member.name || member.email || member.phone}
            </p>
          ) : (
            <p className="text-sm text-gray-400">Member {index + 1}</p>
          )}
          {member.email && member.name && (
            <p className="text-xs text-gray-400 truncate">{member.email}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggle}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
            title="Remove member"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Expanded fields */}
      {expanded && (
        <div className="border-t border-gray-200 px-4 pb-4 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Name</label>
              <input
                type="text"
                value={member.name}
                onChange={(e) => onChange({ ...member, name: e.target.value })}
                placeholder="Rahul Sharma"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={member.email}
                onChange={(e) => onChange({ ...member, email: e.target.value })}
                placeholder="rahul@example.com"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Phone (E.164)</label>
              <input
                type="text"
                value={member.phone}
                onChange={(e) => onChange({ ...member, phone: e.target.value })}
                placeholder="+919876543210"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>User ID</label>
              <input
                type="text"
                value={member.user_id}
                onChange={(e) => onChange({ ...member, user_id: e.target.value })}
                placeholder="user_123"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>FCM Token</label>
              <input
                type="text"
                value={member.fcm_token}
                onChange={(e) => onChange({ ...member, fcm_token: e.target.value })}
                placeholder="fcm-token"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>OneSignal Player ID</label>
              <input
                type="text"
                value={member.onesignal_player_id}
                onChange={(e) => onChange({ ...member, onesignal_player_id: e.target.value })}
                placeholder="abc-123-def"
                className={inputCls}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Audience Editor Modal ────────────────────────────────────────────────────

function AudienceEditorModal({ isOpen, onClose, audience, onSaved }) {
  const isEditing = Boolean(audience?.id);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState([{ ...EMPTY_MEMBER }]);
  const [expandedRows, setExpandedRows] = useState([0]);
  const [saving, setSaving] = useState(false);
  const [csvInput, setCsvInput] = useState("");
  const [showCsvImport, setShowCsvImport] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (audience) {
      setName(audience.name || "");
      setDescription(audience.description || "");
      // Fetch full audience with members
      api.getAudience(audience.id).then((d) => {
        const m = d.data?.members || [];
        setMembers(m.length > 0 ? m.map((mb) => ({ ...EMPTY_MEMBER, ...mb })) : [{ ...EMPTY_MEMBER }]);
        setExpandedRows(m.length === 0 ? [0] : []);
      }).catch(() => {
        setMembers([{ ...EMPTY_MEMBER }]);
      });
    } else {
      setName("");
      setDescription("");
      setMembers([{ ...EMPTY_MEMBER }]);
      setExpandedRows([0]);
    }
    setShowCsvImport(false);
    setCsvInput("");
  }, [isOpen, audience]);

  function addMember() {
    setMembers((prev) => [...prev, { ...EMPTY_MEMBER }]);
    setExpandedRows((prev) => [...prev, members.length]);
  }

  function updateMember(i, val) {
    setMembers((prev) => prev.map((m, idx) => (idx === i ? val : m)));
  }

  function removeMember(i) {
    setMembers((prev) => prev.filter((_, idx) => idx !== i));
    setExpandedRows((prev) => prev.filter((r) => r !== i).map((r) => (r > i ? r - 1 : r)));
  }

  function toggleRow(i) {
    setExpandedRows((prev) =>
      prev.includes(i) ? prev.filter((r) => r !== i) : [...prev, i],
    );
  }

  function handleCsvImport() {
    const lines = csvInput.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return;

    const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
    const newMembers = lines.slice(1).map((line) => {
      const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const obj = { ...EMPTY_MEMBER };
      header.forEach((h, i) => {
        if (h === "name") obj.name = cells[i] || "";
        else if (h === "email") obj.email = cells[i] || "";
        else if (h === "phone") obj.phone = cells[i] || "";
        else if (h === "user_id") obj.user_id = cells[i] || "";
        else if (h === "fcm_token") obj.fcm_token = cells[i] || "";
        else if (h === "onesignal_player_id") obj.onesignal_player_id = cells[i] || "";
      });
      return obj;
    });

    setMembers((prev) => [...prev.filter((m) => m.name || m.email || m.phone), ...newMembers]);
    setShowCsvImport(false);
    setCsvInput("");
    toast.success(`Imported ${newMembers.length} members`);
  }

  function exportCsv() {
    const header = "name,email,phone,user_id,fcm_token,onesignal_player_id";
    const rows = members.map((m) =>
      [m.name, m.email, m.phone, m.user_id, m.fcm_token, m.onesignal_player_id]
        .map((v) => `"${(v || "").replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "audience"}_members.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Audience name is required");
      return;
    }
    const validMembers = members.filter((m) => m.name || m.email || m.phone || m.user_id);
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        members: validMembers,
      };
      if (isEditing) {
        await api.updateAudience(audience.id, payload);
        toast.success("Audience updated");
      } else {
        await api.createAudience(payload);
        toast.success("Audience created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {isEditing ? "Edit Audience" : "New Audience"}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {isEditing ? `Editing "${audience?.name}"` : "Create a named group of users"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Name & description */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Premium users"
                className={inputCls}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className={inputCls}
              />
            </div>
          </div>

          {/* Members */}
          <div>
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h4 className="text-sm font-semibold text-gray-800">
                  Members <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ml-1">{members.length}</span>
                </h4>
                <p className="text-xs text-gray-400 mt-0.5">Valid members need at least one of: email, phone, or user_id</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportCsv}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <Download size={12} />
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() => setShowCsvImport((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-100 transition-colors"
                >
                  <Upload size={12} />
                  Import CSV
                </button>
                <button
                  type="button"
                  onClick={addMember}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors"
                >
                  <Plus size={12} />
                  Add Member
                </button>
              </div>
            </div>

            {showCsvImport && (
              <div className="mb-4 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                <p className="text-xs font-medium text-indigo-700">
                  Paste CSV with header: <code className="bg-indigo-100 px-1 rounded">name,email,phone,user_id,fcm_token,onesignal_player_id</code>
                </p>
                <textarea
                  rows={5}
                  value={csvInput}
                  onChange={(e) => setCsvInput(e.target.value)}
                  placeholder={"name,email,phone\nRahul,rahul@example.com,+919876543210\nPriya,priya@example.com,+919999999999"}
                  className={`${inputCls} font-mono text-xs`}
                />
                <div className="flex gap-2">
                  <button type="button" onClick={handleCsvImport} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition-colors">
                    Import
                  </button>
                  <button type="button" onClick={() => setShowCsvImport(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
              {members.map((member, i) => (
                <MemberRow
                  key={i}
                  member={member}
                  index={i}
                  onChange={(val) => updateMember(i, val)}
                  onRemove={() => removeMember(i)}
                  expanded={expandedRows.includes(i)}
                  onToggle={() => toggleRow(i)}
                />
              ))}
              {members.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">
                  No members yet. Click "Add Member" or import a CSV.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
          <p className="text-xs text-gray-400">
            {members.filter((m) => m.name || m.email || m.phone || m.user_id).length} valid member{members.filter((m) => m.name || m.email || m.phone || m.user_id).length !== 1 ? "s" : ""} will be saved
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? "Saving…" : isEditing ? "Save Changes" : "Create Audience"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main AudiencesPage ───────────────────────────────────────────────────────

export default function AudiencesPage() {
  const [audiences, setAudiences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAudience, setEditingAudience] = useState(null);

  const fetchAudiences = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAudiences();
      setAudiences(data.data || []);
    } catch (err) {
      toast.error("Failed to load audiences: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAudiences();
  }, [fetchAudiences]);

  async function handleDelete(audience) {
    if (!confirm(`Delete audience "${audience.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteAudience(audience.id);
      toast.success("Audience deleted");
      fetchAudiences();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const filtered = audiences.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Users size={22} className="text-indigo-500" />
            Audiences
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage named groups of users for broadcast notifications
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAudiences}
            className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => { setEditingAudience(null); setEditorOpen(true); }}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-all"
          >
            <Plus size={16} />
            New Audience
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search audiences…"
          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 py-20">
          <Users size={48} className="text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-1">
            {search ? "No matching audiences" : "No audiences yet"}
          </h3>
          <p className="text-sm text-gray-400 mb-4">
            {search ? "Try a different search" : "Create your first audience to broadcast to groups"}
          </p>
          {!search && (
            <button
              onClick={() => { setEditingAudience(null); setEditorOpen(true); }}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-all"
            >
              <Plus size={16} />
              New Audience
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((audience) => (
            <div
              key={audience.id}
              className="group relative rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:border-indigo-200 hover:shadow-md transition-all"
            >
              {/* Audience icon */}
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
                  <Users size={18} className="text-indigo-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-900 truncate">{audience.name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {audience.member_count} member{audience.member_count !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              {audience.description && (
                <p className="text-sm text-gray-500 mb-4 line-clamp-2">{audience.description}</p>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-300">
                  Updated {new Date(audience.updated_at).toLocaleDateString()}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditingAudience(audience); setEditorOpen(true); }}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                    title="Edit audience"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(audience)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="Delete audience"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AudienceEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        audience={editingAudience}
        onSaved={fetchAudiences}
      />
    </div>
  );
}
