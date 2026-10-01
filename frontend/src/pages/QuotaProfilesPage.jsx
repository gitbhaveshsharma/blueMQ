import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";
import {
  Plus, Trash2, Edit2, Check, X, ChevronDown, ChevronUp,
  Shield, AlertCircle, Loader2, Star
} from "lucide-react";

const CHANNELS = ["push", "email", "sms", "whatsapp", "inapp", "call"];
const PERIODS = ["monthly", "daily"];

const CHANNEL_COLORS = {
  push: "bg-violet-100 text-violet-700",
  email: "bg-sky-100 text-sky-700",
  sms: "bg-emerald-100 text-emerald-700",
  whatsapp: "bg-green-100 text-green-700",
  inapp: "bg-amber-100 text-amber-700",
  call: "bg-rose-100 text-rose-700",
};

function Badge({ label, colorClass }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function LimitRow({ channel, limit_count, period, onDelete }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
      <div className="flex items-center gap-3">
        <Badge label={channel} colorClass={CHANNEL_COLORS[channel] || "bg-gray-100 text-gray-600"} />
        <span className="text-sm font-semibold text-gray-800">{limit_count.toLocaleString()}</span>
        <span className="text-xs text-gray-500">/ {period}</span>
      </div>
      <button onClick={onDelete} className="p-1 text-red-400 hover:text-red-600 transition-colors">
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function AddLimitForm({ profileId, onAdded }) {
  const [channel, setChannel] = useState("push");
  const [limitCount, setLimitCount] = useState("");
  const [period, setPeriod] = useState("monthly");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    const n = parseInt(limitCount, 10);
    if (isNaN(n) || n < 0) return setErr("Enter a valid non-negative number");
    setLoading(true);
    setErr("");
    try {
      await api.upsertProfileLimit(profileId, { channel, limit_count: n, period });
      setLimitCount("");
      onAdded();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 mt-3 pt-3 border-t border-gray-200">
      <div className="flex-1 min-w-[100px]">
        <label className="block text-xs font-medium text-gray-500 mb-1">Channel</label>
        <select value={channel} onChange={(e) => setChannel(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          {CHANNELS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex-1 min-w-[100px]">
        <label className="block text-xs font-medium text-gray-500 mb-1">Limit</label>
        <input type="number" min="0" value={limitCount} onChange={(e) => setLimitCount(e.target.value)}
          placeholder="e.g. 5000"
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>
      <div className="flex-1 min-w-[100px]">
        <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          {PERIODS.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <button type="submit" disabled={loading}
        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Add
      </button>
      {err && <p className="w-full text-xs text-red-600 mt-1">{err}</p>}
    </form>
  );
}

function ProfileCard({ profile, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(profile.name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleRename() {
    if (!editName.trim() || editName === profile.name) return setEditing(false);
    setSaving(true);
    try {
      await api.updateQuotaProfile(profile.id, { name: editName.trim() });
      onRefresh();
      setEditing(false);
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault() {
    try {
      await api.updateQuotaProfile(profile.id, { is_default: true });
      onRefresh();
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteQuotaProfile(profile.id);
      onRefresh();
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteLimit(channel) {
    try {
      await api.deleteProfileLimit(profile.id, channel);
      onRefresh();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((p) => !p)}>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {profile.is_default && (
            <Star size={14} className="text-amber-400 fill-amber-400 shrink-0" />
          )}
          {editing ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input value={editName} onChange={(e) => setEditName(e.target.value)}
                className="border border-indigo-400 rounded-lg px-2 py-0.5 text-sm focus:outline-none" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditing(false); }} />
              <button onClick={handleRename} disabled={saving} className="text-green-600 hover:text-green-800">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
              <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
            </div>
          ) : (
            <h3 className="text-sm font-semibold text-gray-900 truncate">{profile.name}</h3>
          )}
          {profile.is_default && (
            <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">Default</span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {!profile.is_default && (
            <button onClick={handleSetDefault}
              title="Set as default"
              className="p-1.5 text-gray-400 hover:text-amber-500 transition-colors rounded-lg hover:bg-amber-50">
              <Star size={15} />
            </button>
          )}
          <button onClick={() => { setEditing(true); setExpanded(true); }}
            className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors rounded-lg hover:bg-indigo-50">
            <Edit2 size={15} />
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50">
            {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
          </button>
        </div>
        <div className="text-gray-400 ml-1">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-4 border-t border-gray-100">
          <p className="text-xs text-gray-500 mt-3 mb-2 font-medium uppercase tracking-wide">Channel Limits</p>
          {(profile.limits || []).length === 0 ? (
            <p className="text-sm text-gray-400 italic py-2">No limits configured yet</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {profile.limits.map((l) => (
                <LimitRow key={l.channel} {...l} onDelete={() => handleDeleteLimit(l.channel)} />
              ))}
            </div>
          )}
          <AddLimitForm profileId={profile.id} onAdded={onRefresh} />
        </div>
      )}
    </div>
  );
}

export default function QuotaProfilesPage() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDefault, setNewDefault] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getQuotaProfiles();
      setProfiles(data.profiles || []);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreateLoading(true);
    try {
      await api.createQuotaProfile({ name: newName.trim(), is_default: newDefault });
      setNewName("");
      setNewDefault(false);
      setCreating(false);
      load();
    } catch (e2) {
      alert(e2.message);
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <div className=" mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-xl bg-indigo-100">
              <Shield size={20} className="text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Quota Profiles</h1>
          </div>
          <p className="text-sm text-gray-500">
            Define per-channel notification limits. Assign profiles to owners (coaching centers / parents) for fine-grained quota control.
          </p>
        </div>
        <button onClick={() => setCreating((p) => !p)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium text-sm hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus size={16} />
          New Profile
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <form onSubmit={handleCreate}
          className="mb-6 bg-indigo-50 border border-indigo-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-indigo-800 mb-3">Create New Profile</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Profile Name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Standard Plan"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" autoFocus />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-0.5">
              <input type="checkbox" checked={newDefault} onChange={(e) => setNewDefault(e.target.checked)}
                className="rounded text-indigo-600" />
              Set as default
            </label>
            <button type="submit" disabled={createLoading || !newName.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
              {createLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Create
            </button>
            <button type="button" onClick={() => setCreating(false)}
              className="px-4 py-2 text-gray-600 rounded-lg text-sm hover:bg-gray-200 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-red-700 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-indigo-500" />
        </div>
      )}

      {/* Profiles */}
      {!loading && profiles.length === 0 && !error && (
        <div className="text-center py-20 text-gray-400">
          <Shield size={48} className="mx-auto mb-3 opacity-30" />
          <p className="text-base font-medium">No quota profiles yet</p>
          <p className="text-sm mt-1">Create your first profile to start limiting notifications per channel.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {profiles.map((p) => (
          <ProfileCard key={p.id} profile={p} onRefresh={load} />
        ))}
      </div>
    </div>
  );
}
