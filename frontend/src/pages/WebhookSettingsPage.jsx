import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";
import {
  Webhook, Copy, RefreshCw, Plus, Trash2, CheckCircle2,
  XCircle, Clock, Loader2, AlertCircle, RotateCcw, Eye, EyeOff,
  Send, ShieldCheck
} from "lucide-react";

const STATUS_STYLES = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  delivered: "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed: "bg-red-100 text-red-700 border-red-200",
};

const STATUS_ICONS = {
  pending: <Clock size={12} />,
  delivered: <CheckCircle2 size={12} />,
  failed: <XCircle size={12} />,
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
      {STATUS_ICONS[status]}
      {status}
    </span>
  );
}

function SecretDisplay({ secret, onRotate }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mt-2 p-3 bg-gray-900 rounded-xl flex items-center gap-2">
      <code className="flex-1 font-mono text-xs text-emerald-400 break-all">
        {show ? secret : "•".repeat(Math.min(secret.length, 48))}
      </code>
      <button onClick={() => setShow((p) => !p)} className="text-gray-400 hover:text-white transition-colors p-1">
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button onClick={copy} className="text-gray-400 hover:text-white transition-colors p-1">
        {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
      </button>
      <button onClick={onRotate} title="Rotate secret"
        className="text-gray-400 hover:text-amber-400 transition-colors p-1">
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

function DeliveryRow({ delivery, onRetry }) {
  const [expanded, setExpanded] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function handleRetry(e) {
    e.stopPropagation();
    setRetrying(true);
    try {
      await onRetry(delivery.id);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((p) => !p)}>
        <StatusBadge status={delivery.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{delivery.event_type}</p>
          <p className="text-xs text-gray-500">
            {delivery.notification_id && <span className="mr-2">notif: {delivery.notification_id.slice(0, 8)}…</span>}
            <span>{new Date(delivery.created_at).toLocaleString()}</span>
            <span className="ml-2 text-gray-400">• {delivery.attempts} attempt{delivery.attempts !== 1 ? "s" : ""}</span>
          </p>
        </div>
        {delivery.status === "failed" && (
          <button onClick={handleRetry} disabled={retrying}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors">
            {retrying ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Retry
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 bg-gray-50">
          {delivery.last_error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-mono">
              {delivery.last_error}
            </div>
          )}
          <p className="text-xs text-gray-500 mt-2">
            Delivery ID: <code className="font-mono">{delivery.id}</code>
          </p>
          {delivery.next_attempt_at && delivery.status === "pending" && (
            <p className="text-xs text-gray-500 mt-1">
              Next attempt: {new Date(delivery.next_attempt_at).toLocaleString()}
            </p>
          )}
          {delivery.delivered_at && (
            <p className="text-xs text-gray-500 mt-1">
              Delivered at: {new Date(delivery.delivered_at).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function WebhookSettingsPage() {
  const [config, setConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState("");

  const [deliveries, setDeliveries] = useState([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesTotal, setDeliveriesTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");

  const [newSecret, setNewSecret] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formUrl, setFormUrl] = useState("");
  const [formEvents, setFormEvents] = useState(["notification.final", "quota.threshold"]);
  const [formLoading, setFormLoading] = useState(false);

  const ALLOWED_EVENTS = ["notification.final", "quota.threshold"];

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const data = await api.getWebhookConfig();
      setConfig(data.webhook);
      setConfigError("");
    } catch (e) {
      if (e.message.includes("No webhook")) {
        setConfig(null);
      } else {
        setConfigError(e.message);
      }
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const loadDeliveries = useCallback(async () => {
    setDeliveriesLoading(true);
    try {
      const data = await api.getWebhookDeliveries({ status: statusFilter || undefined, limit: 30 });
      setDeliveries(data.deliveries || []);
      setDeliveriesTotal(data.total || 0);
    } catch (_) {
      setDeliveries([]);
    } finally {
      setDeliveriesLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => { loadDeliveries(); }, [loadDeliveries]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!formUrl.trim()) return;
    setFormLoading(true);
    try {
      const data = await api.createWebhookConfig({ url: formUrl, events: formEvents });
      setNewSecret(data.secret || "");
      setShowCreateForm(false);
      setFormUrl("");
      loadConfig();
    } catch (e2) {
      alert(e2.message);
    } finally {
      setFormLoading(false);
    }
  }

  async function handleRotateSecret() {
    if (!confirm("Rotate the webhook secret? Your current secret will stop working immediately.")) return;
    try {
      const data = await api.updateWebhookConfig({ rotate_secret: true });
      setNewSecret(data.secret || "");
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleToggleActive() {
    try {
      await api.updateWebhookConfig({ is_active: !config.is_active });
      loadConfig();
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleDelete() {
    if (!confirm("Remove webhook configuration? All delivery history will remain in the database.")) return;
    try {
      await api.deleteWebhookConfig();
      setConfig(null);
      setNewSecret("");
    } catch (e) {
      alert(e.message);
    }
  }

  async function handleRetry(deliveryId) {
    await api.retryWebhookDelivery(deliveryId);
    loadDeliveries();
  }

  function toggleEvent(ev) {
    setFormEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  }

  return (
    <div className=" mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="p-2 rounded-xl bg-emerald-100">
            <Webhook size={20} className="text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
        </div>
        <p className="text-sm text-gray-500">
          Receive real-time HTTP callbacks when notifications reach final state or quota thresholds are crossed.
        </p>
      </div>

      {/* Config error */}
      {configError && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          <AlertCircle size={16} />{configError}
        </div>
      )}

      {/* Config loading */}
      {configLoading && (
        <div className="flex justify-center py-10">
          <Loader2 size={28} className="animate-spin text-emerald-500" />
        </div>
      )}

      {/* No config */}
      {!configLoading && !config && !showCreateForm && (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-10 text-center">
          <Webhook size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-base font-semibold text-gray-700 mb-1">No webhook configured</p>
          <p className="text-sm text-gray-500 mb-5">
            Add a webhook to receive real-time delivery events for this app.
          </p>
          <button onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-medium text-sm hover:bg-emerald-700 transition-colors">
            <Plus size={16} />
            Configure Webhook
          </button>
        </div>
      )}

      {/* Create form */}
      {showCreateForm && (
        <form onSubmit={handleCreate}
          className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Send size={16} className="text-emerald-600" />
            Configure Webhook Endpoint
          </h2>

          <label className="block mb-4">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1">Endpoint URL</span>
            <input value={formUrl} onChange={(e) => setFormUrl(e.target.value)}
              type="url" placeholder="https://your-app.com/webhooks/bluemq" required
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>

          <div className="mb-4">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-2">Events</span>
            <div className="flex flex-wrap gap-2">
              {ALLOWED_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={formEvents.includes(ev)} onChange={() => toggleEvent(ev)}
                    className="rounded text-emerald-600" />
                  <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{ev}</code>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={formLoading || !formUrl.trim() || formEvents.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50">
              {formLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Save & Generate Secret
            </button>
            <button type="button" onClick={() => setShowCreateForm(false)}
              className="px-5 py-2.5 text-gray-600 rounded-xl text-sm hover:bg-gray-100 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* New secret display (shown once) */}
      {newSecret && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-5">
          <p className="text-sm font-semibold text-emerald-800 mb-1 flex items-center gap-2">
            <ShieldCheck size={16} />
            Webhook Secret — Save this now!
          </p>
          <p className="text-xs text-emerald-700 mb-2">
            This secret is shown only once. Use it to verify the <code className="bg-emerald-100 px-1 rounded">x-bluemq-signature</code> header on incoming requests.
          </p>
          <SecretDisplay secret={newSecret} onRotate={handleRotateSecret} />
        </div>
      )}

      {/* Config display */}
      {!configLoading && config && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className={`h-2.5 w-2.5 rounded-full ${config.is_active ? "bg-emerald-500" : "bg-gray-400"}`} />
              <h2 className="text-sm font-semibold text-gray-900">Webhook Endpoint</h2>
              <StatusBadge status={config.is_active ? "delivered" : "failed"} />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleToggleActive}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">
                {config.is_active ? "Disable" : "Enable"}
              </button>
              <button onClick={() => setShowCreateForm(true)}
                className="text-xs px-3 py-1.5 rounded-lg border border-indigo-300 text-indigo-600 hover:bg-indigo-50 transition-colors">
                Update
              </button>
              <button onClick={handleDelete}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                Remove
              </button>
            </div>
          </div>

          <div className="px-6 py-4 space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">URL</p>
              <p className="text-sm font-mono text-gray-800 bg-gray-50 rounded-lg px-3 py-2 break-all">{config.url}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Subscribed Events</p>
              <div className="flex flex-wrap gap-2">
                {(config.events || []).map((ev) => (
                  <code key={ev} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded">{ev}</code>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-gray-500">Secret</p>
              <button onClick={handleRotateSecret}
                className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 transition-colors">
                <RefreshCw size={11} />
                Rotate
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Updated: {new Date(config.updated_at).toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {/* Deliveries section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Delivery History</h2>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
            </select>
            <button onClick={loadDeliveries} className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-100 transition-colors">
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        {deliveriesLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={24} className="animate-spin text-emerald-500" />
          </div>
        ) : deliveries.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Webhook size={36} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No deliveries yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {deliveries.map((d) => (
              <DeliveryRow key={d.id} delivery={d} onRetry={handleRetry} />
            ))}
            {deliveriesTotal > deliveries.length && (
              <p className="text-center text-xs text-gray-400 py-2">
                Showing {deliveries.length} of {deliveriesTotal} deliveries
              </p>
            )}
          </div>
        )}
      </div>

      {/* Verification guide */}
      <div className="bg-gray-900 rounded-2xl p-6 text-white">
        <h2 className="text-sm font-semibold mb-3 text-gray-200 flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-400" />
          Verify Incoming Webhook Signatures
        </h2>
        <pre className="text-xs text-emerald-300 overflow-x-auto leading-relaxed">{`// Node.js verification example
const crypto = require('crypto');

function verify(secret, rawBody, signatureHeader) {
  const expected = 'sha256=' +
    crypto.createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');
  if (expected.length !== signatureHeader.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(signatureHeader, 'utf8')
  );
}

// In your Express handler:
app.post('/webhooks/bluemq', express.raw({ type: '*/*' }), (req, res) => {
  const sig = req.headers['x-bluemq-signature'];
  if (!verify(process.env.BLUEMQ_SECRET, req.body.toString(), sig)) {
    return res.status(401).send('Invalid signature');
  }
  const event = JSON.parse(req.body);
  // Handle event.event === 'notification.final' | 'quota.threshold'
  res.sendStatus(200);
});`}</pre>
      </div>
    </div>
  );
}
