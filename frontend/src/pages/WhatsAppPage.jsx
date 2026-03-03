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
  Plus,
  ArrowLeft,
  Phone,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';

/** Extract a renderable QR value: raw string or data:image URI */
function parseQrCode(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw.value) return raw.value;
  return null;
}

const STATUS_STYLES = {
  active: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50 border-green-200', label: 'Connected', dot: 'bg-green-500' },
  pending: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50 border-amber-200', label: 'Pending QR Scan', dot: 'bg-amber-500' },
  disconnected: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 border-red-200', label: 'Disconnected', dot: 'bg-red-500' },
  not_configured: { icon: MessageSquare, color: 'text-gray-400', bg: 'bg-gray-50 border-gray-200', label: 'Not configured', dot: 'bg-gray-400' },
};

export default function WhatsAppPage() {
  // ── View state: 'list' or 'detail' ──
  const [view, setView] = useState('list');

  // ── List view state ──
  const [sessions, setSessions] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [tier, setTier] = useState('core');
  const [tierWarning, setTierWarning] = useState(null);

  // ── Detail view state ──
  const [entityId, setEntityId] = useState('');
  const [entityName, setEntityName] = useState('');
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [sending, setSending] = useState(false);
  const pollRef = useRef(null);

  // ── Load session list on mount ──
  useEffect(() => {
    loadSessions();
  }, []);

  // ── Auto-poll every 5 s while status is pending ──
  useEffect(() => {
    if (session?.status === 'pending' && entityId) {
      pollRef.current = setInterval(async () => {
        try {
          const data = await api.getWhatsAppSession(entityId.trim());
          setSession(data);
          if (data.status === 'active') {
            clearInterval(pollRef.current);
            toast.success('WhatsApp connected successfully!');
            loadSessions();
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

  async function loadSessions() {
    setListLoading(true);
    try {
      const data = await api.listWhatsAppSessions();
      setSessions(data.sessions || []);
      setTier(data.tier || 'core');
      setTierWarning(data.tier_warning || null);
    } catch {
      // silently ignore
    } finally {
      setListLoading(false);
    }
  }

  function openDetail(eid) {
    setEntityId(eid);
    setSession(null);
    setView('detail');
    api.getWhatsAppSession(eid).then(setSession).catch(() => {});
  }

  function openNewSession() {
    setEntityId('');
    setEntityName('');
    setSession(null);
    setView('detail');
  }

  function backToList() {
    clearInterval(pollRef.current);
    setView('list');
    loadSessions();
  }

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
      toast.success('Session created \u2014 scan the QR code below');
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

  async function handleSendTest() {
    if (!testPhone.trim()) {
      toast.error('Enter a phone number to send the test to');
      return;
    }
    const digitsOnly = testPhone.trim().replace(/[^\d]/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      toast.error('Phone must be 7\u201315 digits in international format (e.g. 919876543210)');
      return;
    }
    setSending(true);
    try {
      await api.sendWhatsAppTestMessage(entityId.trim(), digitsOnly, testMessage.trim() || undefined);
      toast.success(`Test message sent to +${digitsOnly}!`);
      setTestMessage('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(eid) {
    const targetId = eid || entityId.trim();
    if (!targetId) return;
    if (!confirm('Disconnect this WhatsApp session?')) return;
    clearInterval(pollRef.current);
    try {
      await api.deleteWhatsAppSession(targetId);
      if (view === 'detail') setSession(null);
      toast.success('Session disconnected');
      loadSessions();
    } catch (err) {
      toast.error(err.message);
    }
  }

  // ════════════════════════════════════════════════
  //  LIST VIEW
  // ════════════════════════════════════════════════
  if (view === 'list') {
    const activeCount = sessions.filter((s) => s.status === 'active').length;

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">WhatsApp Sessions</h2>
            <p className="text-sm text-gray-500">
              {sessions.length === 0
                ? 'No sessions yet \u2014 create one to get started'
                : `${sessions.length} session${sessions.length !== 1 ? 's' : ''} \u00B7 ${activeCount} active`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadSessions}
              disabled={listLoading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={listLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={openNewSession}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-colors"
            >
              <Plus size={14} />
              New Session
            </button>
          </div>
        </div>

        {/* Tier warning banner */}
        {tierWarning && (
          <div className={`flex items-start gap-3 rounded-xl border px-5 py-4 ${
            tier === 'pro'
              ? 'border-orange-200 bg-orange-50'
              : 'border-amber-200 bg-amber-50'
          }`}>
            <AlertTriangle size={18} className={tier === 'pro' ? 'text-orange-500 mt-0.5 shrink-0' : 'text-amber-500 mt-0.5 shrink-0'} />
            <div>
              <p className={`text-sm font-semibold ${tier === 'pro' ? 'text-orange-800' : 'text-amber-800'}`}>
                {tier === 'pro' ? 'WAHA Pro Required' : 'WAHA Plus Required'}
              </p>
              <p className={`text-xs mt-0.5 ${tier === 'pro' ? 'text-orange-700' : 'text-amber-700'}`}>
                {tierWarning}
              </p>
              <a
                href="https://waha.devlike.pro/docs/how-to/plus-version/"
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-block text-xs font-medium mt-1 underline ${tier === 'pro' ? 'text-orange-600' : 'text-amber-600'}`}
              >
                Learn about WAHA tiers &rarr;
              </a>
            </div>
          </div>
        )}

        {/* Single session info (when only 1 session, no warning needed) */}
        {sessions.length <= 1 && !tierWarning && sessions.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-5 py-3">
            <ShieldCheck size={16} className="text-blue-500 mt-0.5 shrink-0" />
            <p className="text-xs text-blue-700">
              Using the default WAHA session &mdash; works with WAHA Core (free). Add more entities to enable multi-session (requires WAHA Plus).
            </p>
          </div>
        )}

        {sessions.length === 0 && !listLoading ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-50">
              <MessageSquare size={28} className="text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">No WhatsApp sessions</h3>
            <p className="mt-1 text-sm text-gray-500">
              Each entity (e.g. coaching centre) gets its own WhatsApp session with a unique phone number.
            </p>
            <button
              onClick={openNewSession}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-colors"
            >
              <Plus size={14} />
              Create First Session
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => {
              const info = STATUS_STYLES[s.status] || STATUS_STYLES.not_configured;
              return (
                <div
                  key={s.entity_id}
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => openDetail(s.entity_id)}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${info.dot}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{s.entity_id}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className={`text-xs font-medium ${info.color}`}>{info.label}</span>
                        {s.phone_number && (
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <Phone size={10} /> +{s.phone_number}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 font-mono">{s.waha_session}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.status === 'disconnected' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openDetail(s.entity_id); }}
                        className="rounded-lg border border-green-200 bg-white px-3 py-1.5 text-xs font-medium text-green-600 hover:bg-green-50 transition-colors"
                      >
                        Reconnect
                      </button>
                    )}
                    {s.status !== 'not_configured' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(s.entity_id); }}
                        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════
  //  DETAIL VIEW
  // ════════════════════════════════════════════════
  const statusInfo = STATUS_STYLES[session?.status] || STATUS_STYLES.not_configured;
  const StatusIcon = statusInfo.icon;
  const qrValue = parseQrCode(session?.qr_code);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Back button */}
      <button
        onClick={backToList}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft size={14} />
        All Sessions
      </button>

      <div>
        <h2 className="text-xl font-bold text-gray-900">
          {entityId ? `Session: ${entityId}` : 'New Session'}
        </h2>
        <p className="text-sm text-gray-500">
          {entityId ? 'Manage this WhatsApp session' : 'Connect a new WhatsApp number for an entity'}
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
              onClick={() => handleDelete()}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={13} />
              Disconnect
            </button>
          </div>

          {/* QR code panel */}
          {session.status === 'pending' && (
            <div className="p-6">
              {qrValue ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-full rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                    <p className="mb-1 text-sm font-semibold text-blue-800">How to scan</p>
                    <ol className="space-y-0.5 text-xs text-blue-700 list-decimal list-inside">
                      <li>Open WhatsApp on your phone</li>
                      <li>Tap <strong>Linked Devices</strong> &rarr; <strong>Link a Device</strong></li>
                      <li>Point your camera at the QR code below</li>
                    </ol>
                  </div>

                  <div className="rounded-2xl bg-white p-5 shadow-md border border-gray-100">
                    {qrValue.startsWith('data:image') ? (
                      <img src={qrValue} alt="WhatsApp QR Code" className="h-56 w-56" />
                    ) : qrValue.length > 500 ? (
                      <img
                        src={`data:image/png;base64,${qrValue}`}
                        alt="WhatsApp QR Code"
                        className="h-56 w-56"
                      />
                    ) : (
                      <QRCodeSVG value={qrValue} size={224} level="M" includeMargin={false} />
                    )}
                  </div>

                  <div className="flex items-center justify-between w-full rounded-lg bg-gray-50 border border-gray-100 px-4 py-2.5">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <RefreshCw size={12} className="animate-spin text-indigo-400" />
                      Auto-refreshing every 5 s&hellip;
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
                <div className="flex flex-col items-center gap-4 py-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
                    <RefreshCw size={28} className="animate-spin text-amber-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">Generating QR code&hellip;</p>
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

          {/* Connected details + test message */}
          {session.status === 'active' && (
            <div className="px-6 py-4 space-y-2">
              {session.phone_number ? (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Smartphone size={15} className="text-green-500" />
                  <span className="font-medium">+{session.phone_number}</span>
                  <span className="text-xs text-gray-400">(WhatsApp number)</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Smartphone size={15} />
                  <span>Phone number loading&hellip; click Check Status to refresh</span>
                </div>
              )}
              {session.connected_at && (
                <p className="text-xs text-gray-400">
                  Connected {new Date(session.connected_at).toLocaleString()}
                </p>
              )}
              {session.waha_session && (
                <p className="text-xs text-gray-400">
                  Session: <span className="font-mono">{session.waha_session}</span>
                </p>
              )}
              {session.entity_id && (
                <p className="text-xs text-gray-400">
                  Entity: <span className="font-medium text-gray-600">{session.entity_id}</span>
                </p>
              )}

              {/* Send test message */}
              <div className="mt-3 rounded-xl border border-green-100 bg-green-50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <MessageSquare size={15} className="text-green-600" />
                  <p className="text-sm font-semibold text-green-800">Send a test message</p>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Recipient phone <span className="text-red-500">*</span>
                      <span className="ml-1 font-normal text-gray-400">
                        (international digits, no + &mdash; e.g. 919876543210)
                      </span>
                    </label>
                    <input
                      type="tel"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendTest()}
                      placeholder="919876543210"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Message{' '}
                      <span className="font-normal text-gray-400">(optional &mdash; uses default if blank)</span>
                    </label>
                    <textarea
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      placeholder="Hello! This is a test from BlueMQ."
                      rows={2}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20 resize-none"
                    />
                  </div>
                  <button
                    onClick={handleSendTest}
                    disabled={sending}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {sending
                      ? <RefreshCw size={14} className="animate-spin" />
                      : <MessageSquare size={14} />}
                    {sending ? 'Sending\u2026' : 'Send Test Message'}
                  </button>
                </div>
              </div>
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
