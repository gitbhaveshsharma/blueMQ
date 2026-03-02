import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import {
  MessageSquare,
  QrCode,
  Trash2,
  RefreshCw,
  CheckCircle,
  Clock,
  XCircle,
  Search,
  Smartphone,
} from 'lucide-react';

/** Extract a renderable QR value: raw string or data:image URI */
function parseQrCode(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  // WAHA sometimes returns { value: "..." }
  if (typeof raw === 'object' && raw.value) return raw.value;
  return null;
}

export default function WhatsAppPage() {
  const [entityId, setEntityId] = useState('');
  const [entityName, setEntityName] = useState('');
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef(null);

  // Auto-poll every 5 s while status is pending
  useEffect(() => {
    if (session?.status === 'pending' && entityId) {
      pollRef.current = setInterval(async () => {
        try {
          const data = await api.getWhatsAppSession(entityId.trim());
          setSession(data);
          if (data.status === 'active') {
            clearInterval(pollRef.current);
            toast.success('WhatsApp connected successfully!');
          }
        } catch {
          // silently ignore poll errors
        }
      }, 5000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [session?.status, entityId]);

  async function fetchSession() {
    if (!entityId.trim()) {
      toast.error('Enter an entity ID');
      return;
    }
    setLoading(true);
    try {
      const data = await api.getWhatsAppSession(entityId.trim());
      setSession(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!entityId.trim()) {
      toast.error('Entity ID is required');
      return;
    }
    setCreating(true);
    try {
      const data = await api.createWhatsAppSession(
        entityId.trim(),
        entityName.trim() || undefined
      );
      setSession(data);
      toast.success('Session created â€” scan the QR code below');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRefreshQR() {
    if (!entityId.trim()) return;
    setRefreshing(true);
    try {
      const data = await api.getWhatsAppSession(entityId.trim());
      setSession(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete() {
    if (!entityId.trim()) return;
    if (!confirm('Disconnect this WhatsApp session?')) return;
    clearInterval(pollRef.current);
    try {
      await api.deleteWhatsAppSession(entityId.trim());
      setSession(null);
      toast.success('Session disconnected');
    } catch (err) {
      toast.error(err.message);
    }
  }

  const STATUS_STYLES = {
    active: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50 border-green-200', label: 'Connected' },
    pending: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50 border-amber-200', label: 'Pending QR Scan' },
    disconnected: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 border-red-200', label: 'Disconnected' },
    not_configured: { icon: MessageSquare, color: 'text-gray-400', bg: 'bg-gray-50 border-gray-200', label: 'Not configured' },
  };

  const statusInfo = STATUS_STYLES[session?.status] || STATUS_STYLES.not_configured;
  const StatusIcon = statusInfo.icon;
  const qrValue = parseQrCode(session?.qr_code);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">WhatsApp Sessions</h2>
        <p className="text-sm text-gray-500">
          Create and manage WhatsApp sessions for entities
        </p>
      </div>

      {/* Entity lookup */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Entity ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchSession()}
              placeholder="coaching_center_1"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Entity Name
            </label>
            <input
              type="text"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              placeholder="My Coaching Center"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={fetchSession}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            Check Status
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {creating ? <RefreshCw size={14} className="animate-spin" /> : <QrCode size={14} />}
            Create / Reconnect
          </button>
        </div>
      </div>

      {/* Session card */}
      {session && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {/* Status bar */}
          <div className={`flex items-center justify-between border-b px-6 py-4 ${statusInfo.bg}`}>
            <div className="flex items-center gap-3">
              <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
              <div>
                <p className="text-sm font-semibold text-gray-800">{statusInfo.label}</p>
                {session.waha_session && (
                  <p className="font-mono text-xs text-gray-400">{session.waha_session}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={13} />
              Disconnect
            </button>
          </div>

          {/* QR code panel â€” shown when pending */}
          {session.status === 'pending' && (
            <div className="p-6">
              {qrValue ? (
                <div className="flex flex-col items-center gap-4">
                  {/* Instructions */}
                  <div className="w-full rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                    <p className="mb-1 text-sm font-semibold text-blue-800">How to scan</p>
                    <ol className="space-y-0.5 text-xs text-blue-700 list-decimal list-inside">
                      <li>Open WhatsApp on your phone</li>
                      <li>Tap <strong>Linked Devices</strong> â†’ <strong>Link a Device</strong></li>
                      <li>Point your camera at the QR code below</li>
                    </ol>
                  </div>

                  {/* QR code */}
                  <div className="rounded-2xl bg-white p-5 shadow-md border border-gray-100">
                    {qrValue.startsWith('data:image') ? (
                      <img src={qrValue} alt="WhatsApp QR Code" className="h-56 w-56" />
                    ) : (
                      <QRCodeSVG
                        value={qrValue}
                        size={224}
                        level="M"
                        includeMargin={false}
                        imageSettings={{
                          src: '',
                          excavate: false,
                        }}
                      />
                    )}
                  </div>

                  {/* Auto-refresh notice + manual refresh */}
                  <div className="flex items-center justify-between w-full rounded-lg bg-gray-50 border border-gray-100 px-4 py-2.5">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <RefreshCw size={12} className="animate-spin text-indigo-400" />
                      Auto-refreshing every 5 sâ€¦
                    </div>
                    <button
                      onClick={handleRefreshQR}
                      disabled={refreshing}
                      className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50"
                    >
                      {refreshing && <RefreshCw size={11} className="animate-spin" />}
                      Refresh QR
                    </button>
                  </div>

                  <p className="text-xs text-gray-400 text-center">
                    QR code rotates every ~20 seconds. The page auto-detects once connected.
                  </p>
                </div>
              ) : (
                /* QR not yet available */
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
                    <RefreshCw size={28} className="animate-spin text-amber-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">Generating QR codeâ€¦</p>
                    <p className="mt-1 text-xs text-gray-400">
                      WAHA is starting the session. This usually takes a few seconds.
                    </p>
                  </div>
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                  >
                    {creating ? <RefreshCw size={14} className="animate-spin" /> : <QrCode size={14} />}
                    Restart &amp; Get QR
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Connected details */}
          {session.status === 'active' && (
            <div className="px-6 py-4 space-y-2">
              {session.phone_number && (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Smartphone size={15} className="text-green-500" />
                  <span className="font-medium">{session.phone_number}</span>
                </div>
              )}
              {session.connected_at && (
                <p className="text-xs text-gray-400">
                  Connected {new Date(session.connected_at).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {/* Disconnected details */}
          {session.status === 'disconnected' && (
            <div className="px-6 py-4">
              <p className="text-sm text-gray-500">
                This session is disconnected. Click <strong>Create / Reconnect</strong> to generate a new QR code.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
