import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import {
  Users, Search, Plus, Trash2, Edit2, Copy, Check, X,
  Loader2, AlertCircle, ChevronLeft, ChevronRight,
  Shield, RefreshCw, Upload, AlertTriangle, Info, ExternalLink
} from "lucide-react";

const CHANNELS = ["push", "email", "sms", "whatsapp", "inapp", "call"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function Toast({ message, type = "error", onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  const colors = type === "error"
    ? "bg-red-50 border-red-200 text-red-700"
    : "bg-green-50 border-green-200 text-green-700";
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-start gap-2 border rounded-xl px-4 py-3 shadow-lg max-w-sm text-sm ${colors}`}>
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100"><X size={14} /></button>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger = false, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4">
        <h3 className="text-base font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${danger
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handleCopy(e) {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button onClick={handleCopy} title="Copy" className="ml-1 text-gray-300 hover:text-gray-600 transition-colors">
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  );
}

function UtilBar({ pct }) {
  const color = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : pct >= 50 ? "bg-indigo-500" : "bg-emerald-500";
  const textColor = pct >= 100 ? "text-red-600" : pct >= 80 ? "text-amber-600" : "text-gray-600";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct || 0)}%` }} />
      </div>
      <span className={`text-xs font-medium tabular-nums ${textColor}`}>{pct ?? 0}%</span>
    </div>
  );
}

function StatusPill({ pct }) {
  if (pct >= 100) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200"><AlertTriangle size={10} />Exceeded</span>;
  if (pct >= 80)  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200"><AlertTriangle size={10} />Warning</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Healthy</span>;
}

// ─── Assign / Edit Owner Modal ────────────────────────────────────────────────

function AssignOwnerModal({ owner, profiles, onSave, onClose }) {
  const isEdit = !!owner;
  const [ownerId, setOwnerId]     = useState(owner?.owner_id || "");
  const [label, setLabel]         = useState(owner?.label || "");
  const [profileId, setProfileId] = useState(owner?.profile?.id || profiles[0]?.id || "");
  const [overrides, setOverrides] = useState(
    owner?.overrides ? Object.entries(owner.overrides).map(([ch, cfg]) => ({ ch, limit: String(cfg.limit), period: cfg.period || "monthly" })) : []
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const usedChannels = overrides.map((o) => o.ch);
  const availableChannels = CHANNELS.filter((c) => !usedChannels.includes(c));

  function addOverride() {
    if (availableChannels.length === 0) return;
    setOverrides((prev) => [...prev, { ch: availableChannels[0], limit: "", period: "monthly" }]);
  }
  function removeOverride(i) {
    setOverrides((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateOverride(i, key, val) {
    setOverrides((prev) => prev.map((o, idx) => idx === i ? { ...o, [key]: val } : o));
  }

  async function handleSave() {
    if (!isEdit && !ownerId.trim()) return setErr("Owner ID is required");
    const ovMap = {};
    for (const o of overrides) {
      const n = parseInt(o.limit, 10);
      if (isNaN(n) || n < 0) return setErr(`Invalid limit for channel "${o.ch}"`);
      ovMap[o.ch] = { limit: n, period: o.period };
    }
    setSaving(true);
    setErr("");
    try {
      await onSave(isEdit ? owner.owner_id : ownerId.trim(), { profile_id: profileId || null, overrides: ovMap, label: label.trim() || null });
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{isEdit ? "Edit Owner" : "Assign Owner"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Owner ID <span className="text-red-500">*</span></label>
              <input value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
                placeholder="e.g. coaching-center-uuid"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Label <span className="text-gray-400">(optional display name)</span></label>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Apex Academy"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Profile</label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">— None (unlimited) —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.is_default ? " (Default)" : ""}</option>
              ))}
            </select>
          </div>

          {/* Overrides */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Channel Overrides <span className="text-gray-400">(optional, override profile limits)</span></label>
              <button onClick={addOverride} disabled={availableChannels.length === 0}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
                <Plus size={12} /> Add
              </button>
            </div>
            {overrides.length === 0 && (
              <p className="text-xs text-gray-400 italic">No overrides — profile limits apply.</p>
            )}
            {overrides.map((o, i) => {
              const available = CHANNELS.filter((c) => c === o.ch || !usedChannels.includes(c));
              return (
                <div key={i} className="flex items-center gap-2 mb-2">
                  <select value={o.ch} onChange={(e) => updateOverride(i, "ch", e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-shrink-0">
                    {available.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input type="number" min="0" value={o.limit} onChange={(e) => updateOverride(i, "limit", e.target.value)}
                    placeholder="limit"
                    className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <select value={o.period} onChange={(e) => updateOverride(i, "period", e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-shrink-0">
                    <option value="monthly">monthly</option>
                    <option value="daily">daily</option>
                  </select>
                  <button onClick={() => removeOverride(i)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                </div>
              );
            })}
          </div>

          {err && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} />{err}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {isEdit ? "Save Changes" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Assign Modal ────────────────────────────────────────────────────────

function BulkAssignModal({ profiles, onSave, onClose }) {
  const [rawIds, setRawIds]       = useState("");
  const [profileId, setProfileId] = useState(profiles[0]?.id || "");
  const [saving, setSaving]       = useState(false);
  const [result, setResult]       = useState(null);
  const [err, setErr]             = useState("");

  async function handleBulk() {
    const ids = rawIds.split("\n").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return setErr("Paste at least one owner ID");
    if (ids.length > 500) return setErr("Maximum 500 IDs per bulk call");
    if (!profileId) return setErr("Select a profile");
    setSaving(true);
    setErr("");
    try {
      const res = await api.bulkAssignOwners({ owner_ids: ids, profile_id: profileId });
      setResult(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">Bulk Assign Results</h2>
            <button onClick={() => { onClose(); onSave(); }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <div className="px-6 py-5">
            <div className="flex gap-4 mb-4">
              <div className="text-center flex-1 bg-green-50 rounded-xl py-3">
                <p className="text-2xl font-bold text-green-700">{result.summary.succeeded}</p>
                <p className="text-xs text-green-600">Succeeded</p>
              </div>
              <div className="text-center flex-1 bg-red-50 rounded-xl py-3">
                <p className="text-2xl font-bold text-red-700">{result.summary.failed}</p>
                <p className="text-xs text-red-600">Failed</p>
              </div>
            </div>
            {result.results.filter((r) => !r.success).length > 0 && (
              <div className="max-h-40 overflow-y-auto space-y-1">
                {result.results.filter((r) => !r.success).map((r) => (
                  <div key={r.owner_id} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                    <strong>{r.owner_id}</strong>: {r.error}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end px-6 py-4 border-t border-gray-100">
            <button onClick={() => { onClose(); onSave(); }}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Bulk Assign Owners</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Profile</label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.is_default ? " (Default)" : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Owner IDs <span className="text-gray-400">(one per line, max 500)</span>
            </label>
            <textarea value={rawIds} onChange={(e) => setRawIds(e.target.value)} rows={8}
              placeholder={"uuid-owner-1\nuuid-owner-2\nuuid-owner-3"}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
            <p className="text-xs text-gray-400 mt-1">
              {rawIds.split("\n").filter((s) => s.trim()).length} IDs entered
            </p>
          </div>
          {err && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} />{err}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleBulk} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Assign All
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function QuotaOwnersPage() {
  const navigate = useNavigate();

  const [owners, setOwners]       = useState([]);
  const [profiles, setProfiles]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [filterProfile, setFilterProfile] = useState("");
  const [toast, setToast]         = useState(null);
  const [modal, setModal]         = useState(null); // null | 'assign' | 'bulk' | { type: 'edit', owner } | { type: 'remove', owner }
  const LIMIT = 20;

  const q = useDebounce(searchInput);

  const showToast = useCallback((msg, type = "error") => setToast({ message: msg, type }), []);

  const loadProfiles = useCallback(async () => {
    try {
      const d = await api.getQuotaProfiles();
      setProfiles(d.profiles || []);
    } catch {}
  }, []);

  const loadOwners = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.getQuotaOwners({ q: q || undefined, profile_id: filterProfile || undefined, page, limit: LIMIT });
      setOwners(d.owners || []);
      setTotal(d.pagination?.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [q, filterProfile, page]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);
  useEffect(() => {
    setPage(1); // reset page when filters change
  }, [q, filterProfile]);
  useEffect(() => { loadOwners(); }, [loadOwners]);

  async function handleSaveOwner(ownerId, data) {
    await api.upsertOwnerQuota(ownerId, data);
    showToast(`Owner "${ownerId}" saved.`, "success");
    loadOwners();
  }

  async function handleRemove(owner) {
    try {
      await api.deleteOwnerQuota(owner.owner_id);
      showToast(`Owner "${owner.owner_id}" removed.`, "success");
      loadOwners();
    } catch (e) {
      showToast(e.message, "error");
    }
    setModal(null);
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="mx-auto">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Modals */}
      {modal === "assign" && (
        <AssignOwnerModal profiles={profiles} onSave={handleSaveOwner} onClose={() => setModal(null)} />
      )}
      {modal === "bulk" && (
        <BulkAssignModal profiles={profiles} onSave={loadOwners} onClose={() => setModal(null)} />
      )}
      {modal?.type === "edit" && (
        <AssignOwnerModal owner={modal.owner} profiles={profiles} onSave={handleSaveOwner} onClose={() => setModal(null)} />
      )}
      {modal?.type === "remove" && (
        <ConfirmDialog
          title={`Remove owner?`}
          message={`Remove quota assignment for "${modal.owner.label || modal.owner.owner_id}"? Their quota record will be deleted.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => handleRemove(modal.owner)}
          onCancel={() => setModal(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-xl bg-violet-100">
              <Users size={20} className="text-violet-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Quota Owners</h1>
          </div>
          <p className="text-sm text-gray-500">
            Manage quota assignments for owners (tenants). Each owner can have a profile and per-channel overrides.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadOwners}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-100 transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setModal("bulk")}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 text-white rounded-xl font-medium text-sm hover:bg-gray-900 transition-colors shadow-sm">
            <Upload size={15} />
            Bulk Assign
          </button>
          <button onClick={() => setModal("assign")}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-medium text-sm hover:bg-indigo-700 transition-colors shadow-sm">
            <Plus size={16} />
            Assign Owner
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search owner ID or label…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select value={filterProfile} onChange={(e) => setFilterProfile(e.target.value)}
          className="border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">All profiles</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name}{p.is_default ? " (Default)" : ""}</option>
          ))}
        </select>
        {(searchInput || filterProfile) && (
          <button onClick={() => { setSearchInput(""); setFilterProfile(""); }}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <X size={14} /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{total} owner{total !== 1 ? "s" : ""} total</span>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-red-700 text-sm">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={28} className="animate-spin text-indigo-500" />
          </div>
        ) : owners.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Users size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-base font-medium">No owners found</p>
            <p className="text-sm mt-1">
              {searchInput || filterProfile
                ? "Try clearing your filters."
                : "Assign an owner to get started."}
            </p>
            {!searchInput && !filterProfile && (
              <button onClick={() => setModal("assign")}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors">
                <Plus size={14} /> Assign Owner
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {["Owner", "Profile", "Overrides", "Utilization", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {owners.map((owner) => (
                <tr key={owner.owner_id}
                  onClick={() => navigate(`/quota/owners/${encodeURIComponent(owner.owner_id)}`)}
                  className="hover:bg-indigo-50/40 cursor-pointer transition-colors">
                  {/* Owner ID + label */}
                  <td className="px-4 py-3.5 max-w-[220px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-xs text-gray-700 truncate" title={owner.owner_id}>
                        {owner.owner_id}
                      </span>
                      <CopyButton text={owner.owner_id} />
                      <ExternalLink size={11} className="text-gray-300 shrink-0" />
                    </div>
                    {owner.label && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{owner.label}</p>
                    )}
                  </td>

                  {/* Profile */}
                  <td className="px-4 py-3.5">
                    {owner.profile ? (
                      <div className="flex items-center gap-1.5">
                        <Shield size={13} className="text-indigo-400 shrink-0" />
                        <span className="text-xs text-gray-700">{owner.profile.name}</span>
                        {owner.profile.is_default && (
                          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded-full font-medium">Default</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 italic">None</span>
                    )}
                  </td>

                  {/* Override count */}
                  <td className="px-4 py-3.5">
                    {owner.override_count > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                        {owner.override_count} channel{owner.override_count !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>

                  {/* Utilization bar */}
                  <td className="px-4 py-3.5 min-w-[140px]">
                    <UtilBar pct={owner.highest_utilization} />
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3.5">
                    <StatusPill pct={owner.highest_utilization} />
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setModal({ type: "edit", owner })}
                        title="Edit"
                        className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => setModal({ type: "remove", owner })}
                        title="Remove"
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500">
            Page {page} of {totalPages} · {total} owners
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              <ChevronLeft size={14} /> Prev
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
