import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";
import {
  BarChart3, RefreshCw, Loader2, AlertCircle, TrendingUp,
  TrendingDown, Minus, Activity, Bell, AlertTriangle
} from "lucide-react";

const CHANNEL_COLORS = {
  push: { bar: "bg-violet-500", text: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200" },
  email: { bar: "bg-sky-500", text: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200" },
  sms: { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  whatsapp: { bar: "bg-green-500", text: "text-green-700", bg: "bg-green-50", border: "border-green-200" },
  inapp: { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  call: { bar: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-200" },
};

function pct(used, limit) {
  if (!limit || limit === Infinity) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function UsageBar({ used, reserved, limit, channel }) {
  const colors = CHANNEL_COLORS[channel] || { bar: "bg-gray-500", text: "text-gray-700", bg: "bg-gray-50", border: "border-gray-200" };
  const usedPct = pct(used, limit);
  const rsvPct = pct(reserved, limit);
  const criticalLevel = usedPct >= 90 ? "text-red-600" : usedPct >= 75 ? "text-amber-600" : colors.text;

  return (
    <div className={`rounded-xl border p-4 ${colors.bg} ${colors.border}`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-semibold capitalize ${colors.text}`}>{channel}</span>
        {limit && limit !== Infinity ? (
          <span className={`text-sm font-bold ${criticalLevel}`}>
            {used.toLocaleString()} / {limit.toLocaleString()}
            <span className="text-xs ml-1 font-normal">({usedPct}%)</span>
          </span>
        ) : (
          <span className="text-sm text-gray-500">unlimited</span>
        )}
      </div>

      {limit && limit !== Infinity ? (
        <div className="h-2 bg-white rounded-full overflow-hidden flex">
          <div className={`h-full rounded-full transition-all ${colors.bar} opacity-100`}
            style={{ width: `${usedPct}%` }} />
          <div className={`h-full transition-all ${colors.bar} opacity-40`}
            style={{ width: `${Math.min(rsvPct, 100 - usedPct)}%` }} />
        </div>
      ) : (
        <div className="h-2 bg-white rounded-full overflow-hidden">
          <div className="h-full bg-gray-200 rounded-full w-full" />
        </div>
      )}

      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${colors.bar}`} />
          Used: {used.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${colors.bar} opacity-40`} />
          Reserved: {reserved.toLocaleString()}
        </span>
        {limit && limit !== Infinity && (
          <span className="ml-auto font-medium text-gray-600">
            {Math.max(0, limit - used - reserved).toLocaleString()} remaining
          </span>
        )}
      </div>
    </div>
  );
}

function OwnerUsageCard({ ownerId, rows }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <button className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((p) => !p)}>
        <div className="flex items-center gap-2 min-w-0">
          <Activity size={15} className="text-indigo-500 shrink-0" />
          <span className="text-sm font-semibold text-gray-900 truncate">{ownerId}</span>
          <span className="text-xs text-gray-500 ml-1">({rows.length} channel{rows.length !== 1 ? "s" : ""})</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {rows.map((r) => {
            const p = pct(r.used || 0, r.limit);
            return (
              <span key={r.channel}
                className={`px-1.5 py-0.5 rounded-full border font-medium ${p >= 90 ? "bg-red-50 text-red-600 border-red-200" : p >= 75 ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}>
                {r.channel} {p}%
              </span>
            );
          })}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
            {rows.map((r) => (
              <UsageBar
                key={`${r.owner_id}-${r.channel}-${r.period_start}`}
                used={Number(r.used) || 0}
                reserved={Number(r.reserved) || 0}
                limit={r.limit ? Number(r.limit) : Infinity}
                channel={r.channel}
              />
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-400">
            Period: {rows[0]?.period_start} · Updated: {rows[0]?.updated_at ? new Date(rows[0].updated_at).toLocaleString() : "—"}
          </div>
        </div>
      )}
    </div>
  );
}

function ThresholdBadge({ threshold }) {
  const color = threshold >= 100 ? "bg-red-100 text-red-700 border-red-200" : "bg-amber-100 text-amber-700 border-amber-200";
  const Icon = threshold >= 100 ? AlertTriangle : TrendingUp;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      <Icon size={11} />
      {threshold}%
    </span>
  );
}

export default function UsageOverviewPage() {
  const [usage, setUsage] = useState([]);
  const [thresholds, setThresholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [usageData, threshData] = await Promise.all([
        api.getQuotaUsage(),
        api.getThresholdEvents({ limit: 20 }),
      ]);
      setUsage(usageData.usage || []);
      setThresholds(threshData.threshold_events || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Group usage rows by owner_id
  const byOwner = {};
  for (const row of usage) {
    if (!byOwner[row.owner_id]) byOwner[row.owner_id] = [];
    byOwner[row.owner_id].push(row);
  }

  const filteredOwners = Object.entries(byOwner).filter(([id]) =>
    !ownerFilter || id.toLowerCase().includes(ownerFilter.toLowerCase())
  );

  // Aggregate totals
  const totalUsed = usage.reduce((sum, r) => sum + (Number(r.used) || 0), 0);
  const totalReserved = usage.reduce((sum, r) => sum + (Number(r.reserved) || 0), 0);
  const ownersCount = Object.keys(byOwner).length;
  const criticalCount = Object.values(byOwner).flat().filter((r) => pct(r.used, r.limit) >= 80).length;

  return (
    <div className=" mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-xl bg-violet-100">
              <BarChart3 size={20} className="text-violet-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Usage Overview</h1>
          </div>
          <p className="text-sm text-gray-500">
            Real-time quota consumption across all owners and channels.
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm hover:bg-gray-100 transition-colors">
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Used", value: totalUsed.toLocaleString(), icon: Bell, color: "text-indigo-600", bg: "bg-indigo-50" },
          { label: "Reserved", value: totalReserved.toLocaleString(), icon: Activity, color: "text-amber-600", bg: "bg-amber-50" },
          { label: "Owners", value: ownersCount, icon: BarChart3, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Critical Channels", value: criticalCount, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <div className={`inline-flex p-2 rounded-xl ${bg} mb-3`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin text-violet-500" />
        </div>
      ) : (
        <>
          {/* Owner list */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">By Owner</h2>
              <input
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                placeholder="Filter by owner ID…"
                className="border border-gray-300 rounded-xl px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500 w-64"
              />
            </div>

            {filteredOwners.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Activity size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No usage data available</p>
                <p className="text-xs mt-1">Quota usage appears here once notifications are sent.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredOwners.map(([ownerId, rows]) => (
                  <OwnerUsageCard key={ownerId} ownerId={ownerId} rows={rows} />
                ))}
              </div>
            )}
          </div>

          {/* Threshold events */}
          {thresholds.length > 0 && (
            <div>
              <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-500" />
                Recent Threshold Events
              </h2>
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {["Owner", "Channel", "Threshold", "Period Start", "Fired At"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {thresholds.map((t, i) => (
                      <tr key={i} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-700 truncate max-w-[180px]">{t.owner_id}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${CHANNEL_COLORS[t.channel]?.bg || "bg-gray-100"} ${CHANNEL_COLORS[t.channel]?.text || "text-gray-600"}`}>
                            {t.channel}
                          </span>
                        </td>
                        <td className="px-4 py-3"><ThresholdBadge threshold={t.threshold} /></td>
                        <td className="px-4 py-3 text-xs text-gray-500">{t.period_start}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{new Date(t.fired_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
