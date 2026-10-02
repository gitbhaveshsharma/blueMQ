import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import {
  ArrowLeft, Users, Shield, Edit2, Check, X, Plus, Trash2,
  AlertCircle, Loader2, AlertTriangle, Activity, Copy,
  GitBranch, Bell, RefreshCw, Info, ChevronDown, ChevronUp
} from "lucide-react";

const CHANNELS = ["push", "email", "sms", "whatsapp", "inapp", "call"];

const CHANNEL_COLORS = {
  push:     { bar: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
  email:    { bar: "bg-sky-500",    bg: "bg-sky-50",    text: "text-sky-700",    border: "border-sky-200" },
  sms:      { bar: "bg-emerald-500",bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200" },
  whatsapp: { bar: "bg-green-500",  bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  inapp:    { bar: "bg-amber-500",  bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200" },
  call:     { bar: "bg-rose-500",   bg: "bg-rose-50",   text: "text-rose-700",   border: "border-rose-200" },
};

const SOURCE_BADGES = {
  override:       "bg-purple-50 text-purple-700 border-purple-200",
  profile:        "bg-indigo-50 text-indigo-700 border-indigo-200",
  default_profile:"bg-gray-100 text-gray-600 border-gray-200",
  none:           "bg-gray-50 text-gray-400 border-gray-100",
};

const SOURCE_LABELS = {
  override: "Override",
  profile: "Profile",
  default_profile: "Default",
  none: "None",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handleCopy(e) {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  return (
    <button onClick={handleCopy} className="ml-1 text-gray-300 hover:text-gray-600 transition-colors">
      {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  );
}

function Toast({ message, type = "error", onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const colors = type === "error" ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700";
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-start gap-2 border rounded-xl px-4 py-3 shadow-lg max-w-sm text-sm ${colors}`}>
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100"><X size={14} /></button>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    exceeded: "bg-red-50 text-red-700 border-red-200",
    warning:  "bg-amber-50 text-amber-700 border-amber-200",
    healthy:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${map[status] || map.healthy}`}>
      {status}
    </span>
  );
}

// ─── Effective Limit Card ─────────────────────────────────────────────────────

function LimitCard({ ch }) {
  const colors = CHANNEL_COLORS[ch.channel] || { bar: "bg-gray-500", bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200" };
  const hasLimit = ch.limit !== null;
  const pct = ch.percentage ?? 0;

  return (
    <div className={`rounded-xl border p-4 ${colors.bg} ${colors.border}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold capitalize ${colors.text}`}>{ch.channel}</span>
          <span className={`text-xs border px-1.5 py-0.5 rounded-full font-medium ${SOURCE_BADGES[ch.source]}`}>
            {SOURCE_LABELS[ch.source]}
          </span>
        </div>
        <StatusBadge status={ch.status} />
      </div>

      {hasLimit ? (
        <>
          <div className="h-2 bg-white/70 rounded-full overflow-hidden flex mb-2">
            <div className={`h-full rounded-full transition-all ${colors.bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
            {ch.reserved > 0 && (
              <div className={`h-full transition-all ${colors.bar} opacity-40`}
                style={{ width: `${Math.min(100 - pct, Math.round((ch.reserved / ch.limit) * 100))}%` }} />
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-gray-600">
            <div className="flex gap-3">
              <span>Used: <strong>{(ch.used ?? 0).toLocaleString()}</strong></span>
              {ch.reserved > 0 && <span>Reserved: <strong>{ch.reserved.toLocaleString()}</strong></span>}
              <span>Limit: <strong>{ch.limit.toLocaleString()}</strong> / {ch.period}</span>
            </div>
            <span className="font-semibold">{pct}%</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {(ch.remaining ?? 0).toLocaleString()} remaining · {ch.period_start} → {ch.period_end}
          </p>
        </>
      ) : (
        <div className="text-xs text-gray-500 mt-1">
          <span className="font-medium">Unlimited</span>
          {ch.sent_count !== undefined && (
            <span className="ml-2">· {ch.sent_count.toLocaleString()} sent this period</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Overrides Editor ─────────────────────────────────────────────────────────

function OverridesEditor({ owner, onSaved, onToast }) {
  const [overrides, setOverrides] = useState(
    owner.overrides
      ? Object.entries(owner.overrides).map(([ch, cfg]) => ({ ch, limit: String(cfg.limit), period: cfg.period || "monthly" }))
      : []
  );
  const [saving, setSaving] = useState(false);

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
    const ovMap = {};
    for (const o of overrides) {
      const n = parseInt(o.limit, 10);
      if (isNaN(n) || n < 0) { onToast(`Invalid limit for ${o.ch}`, "error"); return; }
      ovMap[o.ch] = { limit: n, period: o.period };
    }
    setSaving(true);
    try {
      await api.upsertOwnerQuota(owner.owner_id, {
        profile_id: owner.profile?.id || null,
        label: owner.label || null,
        overrides: ovMap,
      });
      onToast("Overrides saved.", "success");
      onSaved();
    } catch (e) {
      onToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {overrides.length === 0 && (
        <p className="text-sm text-gray-400 italic">No overrides — profile limits apply.</p>
      )}
      {overrides.map((o, i) => {
        const available = CHANNELS.filter((c) => c === o.ch || !usedChannels.includes(c));
        return (
          <div key={i} className="flex items-center gap-2">
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
            <button onClick={() => removeOverride(i)} className="text-red-400 hover:text-red-600 p-1"><X size={14} /></button>
          </div>
        );
      })}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={addOverride} disabled={availableChannels.length === 0}
          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-40">
          <Plus size={12} /> Add channel
        </button>
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save Overrides
        </button>
      </div>
    </div>
  );
}

// ─── Branches Section ─────────────────────────────────────────────────────────

function BranchesSection({ ownerId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getOwnerBranches(ownerId)
      .then((d) => setData(d))
      .catch(() => setData({ branches: [] }))
      .finally(() => setLoading(false));
  }, [ownerId]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-400" /></div>;
  if (!data?.branches?.length) return <p className="text-sm text-gray-400 italic py-4">No branch-level usage data yet.</p>;

  return (
    <div className="space-y-3">
      {data.branches.map((branch) => (
        <div key={branch.entity_id} className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-gray-100">
            <GitBranch size={14} className="text-gray-500" />
            <span className="font-mono text-xs text-gray-700">{branch.entity_id}</span>
            <CopyButton text={branch.entity_id} />
          </div>
          <div className="px-4 py-3 flex flex-wrap gap-3">
            {branch.channels.map((c) => (
              <div key={c.channel} className="flex items-center gap-1.5 text-xs">
                <span className={`px-2 py-0.5 rounded-full font-medium ${CHANNEL_COLORS[c.channel]?.bg || "bg-gray-100"} ${CHANNEL_COLORS[c.channel]?.text || "text-gray-600"}`}>
                  {c.channel}
                </span>
                <span className="text-gray-600">{c.used} used</span>
                {c.reserved > 0 && <span className="text-gray-400">· {c.reserved} reserved</span>}
                <span className="text-gray-400">· {c.notification_count} notifs</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Recent Notifications ─────────────────────────────────────────────────────

function RecentNotifications({ ownerId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEntityNotifications(ownerId, { limit: 20 })
      .then((d) => setData(d))
      .catch(() => setData({ notifications: [] }))
      .finally(() => setLoading(false));
  }, [ownerId]);

  const STATUS_COLORS = {
    sent: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    pending: "bg-yellow-100 text-yellow-700",
    permanently_failed: "bg-red-200 text-red-800",
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-gray-400" /></div>;
  if (!data?.notifications?.length) return <p className="text-sm text-gray-400 italic py-4">No notifications yet for this owner.</p>;

  return (
    <div className="space-y-1.5">
      {data.notifications.map((n) => (
        <div key={n.id} className="flex items-start gap-3 bg-gray-50 hover:bg-gray-100 transition-colors rounded-lg px-3 py-2.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLORS[n.status] || "bg-gray-100 text-gray-600"}`}>
                {n.status}
              </span>
              {n.type && <span className="text-xs text-gray-500 font-medium">{n.type}</span>}
              <span className="text-xs text-gray-400 ml-auto">{new Date(n.created_at).toLocaleString()}</span>
            </div>
            {n.title && <p className="text-xs font-medium text-gray-800 truncate">{n.title}</p>}
            {n.message && <p className="text-xs text-gray-500 truncate">{n.message}</p>}
            <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">{n.external_user_id || n.entity_id}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Threshold Events ─────────────────────────────────────────────────────────

function ThresholdEvents({ ownerId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getThresholdEvents({ owner_id: ownerId, limit: 10 })
      .then((d) => setData(d))
      .catch(() => setData({ threshold_events: [] }))
      .finally(() => setLoading(false));
  }, [ownerId]);

  if (loading) return <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-gray-400" /></div>;
  if (!data?.threshold_events?.length) return <p className="text-sm text-gray-400 italic py-2">No threshold events this period.</p>;

  return (
    <div className="space-y-2">
      {data.threshold_events.map((ev, i) => (
        <div key={i} className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className={ev.threshold >= 100 ? "text-red-500" : "text-amber-500"} />
          <div className="flex-1 text-xs">
            <span className="font-semibold capitalize">{ev.channel}</span>
            <span className="text-gray-600 ml-2">hit <strong>{ev.threshold}%</strong> threshold</span>
          </div>
          <span className="text-xs text-gray-400">{new Date(ev.fired_at).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Section Wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon: Icon, iconColor = "text-gray-500", iconBg = "bg-gray-100", children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      <button className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${iconBg}`}>
            <Icon size={16} className={iconColor} />
          </div>
          <span className="text-sm font-semibold text-gray-800">{title}</span>
        </div>
        {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>
      {open && <div className="px-6 pb-5 border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OwnerDetailPage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "error") => setToast({ message: msg, type }), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.getQuotaOwner(ownerId);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex justify-center py-24">
      <Loader2 size={32} className="animate-spin text-indigo-500" />
    </div>
  );

  if (error) return (
    <div>
      <button onClick={() => navigate("/quota/owners")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors">
        <ArrowLeft size={15} /> Back to Owners
      </button>
      <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
        <AlertCircle size={16} />{error}
      </div>
    </div>
  );

  const owner = data?.owner;
  const effectiveLimits = data?.effective_limits || [];
  const limitedChannels = effectiveLimits.filter((c) => c.limit !== null);
  const unlimitedChannels = effectiveLimits.filter((c) => c.limit === null);

  return (
    <div className="mx-auto space-y-5">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Back + header */}
      <div>
        <button onClick={() => navigate("/quota/owners")}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-4 transition-colors">
          <ArrowLeft size={15} /> Back to Owners
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-2 rounded-xl bg-violet-100">
                <Users size={20} className="text-violet-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-gray-900 font-mono">{ownerId}</h1>
                  <CopyButton text={ownerId} />
                </div>
                {owner?.label && <p className="text-sm text-gray-500">{owner.label}</p>}
              </div>
            </div>
            {owner?.profile && (
              <div className="flex items-center gap-1.5 mt-1">
                <Shield size={13} className="text-indigo-400" />
                <span className="text-xs text-gray-600">Profile: <strong>{owner.profile.name}</strong></span>
                {owner.profile.is_default && (
                  <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">Default</span>
                )}
              </div>
            )}
          </div>
          <button onClick={load}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-100 transition-colors shrink-0">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Effective Limits */}
      <Section title="Effective Limits" icon={Activity} iconColor="text-indigo-600" iconBg="bg-indigo-100">
        <div className="mt-4">
          {limitedChannels.length === 0 && unlimitedChannels.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              <Info size={14} className="text-blue-500" />
              No quota configured for this owner. All channels are unlimited.
            </div>
          )}
          {limitedChannels.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
              {limitedChannels.map((ch) => <LimitCard key={ch.channel} ch={ch} />)}
            </div>
          )}
          {unlimitedChannels.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Unlimited Channels</p>
              <div className="flex flex-wrap gap-2">
                {unlimitedChannels.map((ch) => (
                  <div key={ch.channel} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs">
                    <span className="font-medium text-gray-600 capitalize">{ch.channel}</span>
                    <span className="text-gray-400">unlimited</span>
                    {ch.sent_count !== undefined && (
                      <span className="text-gray-500">{ch.sent_count.toLocaleString()} sent</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Overrides Editor */}
      <Section title="Channel Overrides" icon={Edit2} iconColor="text-purple-600" iconBg="bg-purple-100">
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
            <Info size={13} />
            Overrides take precedence over profile limits for this specific owner.
          </div>
          {owner && (
            <OverridesEditor owner={owner} onSaved={load} onToast={showToast} />
          )}
        </div>
      </Section>

      {/* Threshold Events */}
      <Section title="Recent Threshold Events" icon={AlertTriangle} iconColor="text-amber-600" iconBg="bg-amber-100" defaultOpen={false}>
        <div className="mt-4">
          <ThresholdEvents ownerId={ownerId} />
        </div>
      </Section>

      {/* Per-branch breakdown */}
      <Section title="Branch Breakdown" icon={GitBranch} iconColor="text-teal-600" iconBg="bg-teal-100" defaultOpen={false}>
        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-3">Per-entity (branch) usage derived from quota reservations for the current period.</p>
          <BranchesSection ownerId={ownerId} />
        </div>
      </Section>

      {/* Recent Notifications */}
      <Section title="Recent Notifications" icon={Bell} iconColor="text-sky-600" iconBg="bg-sky-100" defaultOpen={false}>
        <div className="mt-4">
          <p className="text-xs text-gray-400 mb-3">Last 20 notifications for this owner (no sensitive data shown).</p>
          <RecentNotifications ownerId={ownerId} />
        </div>
      </Section>
    </div>
  );
}
