import { useEffect, useState } from 'react';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  MessageSquare,
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
  ShieldCheck,
  KeyRound,
  Building2,
} from 'lucide-react';

const STATUS_STYLES = {
  active: {
    icon: CheckCircle,
    color: 'text-green-500',
    bg: 'bg-green-50 border-green-200',
    label: 'Connected',
    dot: 'bg-green-500',
  },
  pending: {
    icon: Clock,
    color: 'text-amber-500',
    bg: 'bg-amber-50 border-amber-200',
    label: 'Pending',
    dot: 'bg-amber-500',
  },
  disconnected: {
    icon: XCircle,
    color: 'text-red-500',
    bg: 'bg-red-50 border-red-200',
    label: 'Disconnected',
    dot: 'bg-red-500',
  },
  not_configured: {
    icon: MessageSquare,
    color: 'text-gray-400',
    bg: 'bg-gray-50 border-gray-200',
    label: 'Not configured',
    dot: 'bg-gray-400',
  },
};

function sanitizePhone(input) {
  return String(input || '').replace(/[^0-9]/g, '');
}

export default function WhatsAppPage() {
  const [view, setView] = useState('list');

  const [sessions, setSessions] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  const [entityId, setEntityId] = useState('');
  const [entityName, setEntityName] = useState('');
  const [metaApiKey, setMetaApiKey] = useState('');
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState('');
  const [metaBusinessAccountId, setMetaBusinessAccountId] = useState('');

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setListLoading(true);
    try {
      const data = await api.listWhatsAppSessions();
      setSessions(data.sessions || []);
    } catch {
      // ignore silently for dashboard experience
    } finally {
      setListLoading(false);
    }
  }

  function resetForm() {
    setEntityId('');
    setEntityName('');
    setMetaApiKey('');
    setMetaPhoneNumberId('');
    setMetaBusinessAccountId('');
    setSession(null);
    setTestPhone('');
    setTestMessage('');
  }

  function openNewSession() {
    resetForm();
    setView('detail');
  }

  async function openDetail(eid) {
    setEntityId(eid);
    setSession(null);
    setMetaApiKey('');
    setTestPhone('');
    setTestMessage('');
    setView('detail');

    try {
      const data = await api.getWhatsAppSession(eid);
      setSession(data);
      setMetaPhoneNumberId(data.meta_phone_number_id || '');
      setMetaBusinessAccountId(data.meta_business_account_id || '');
    } catch {
      // ignore
    }
  }

  function backToList() {
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
      setMetaPhoneNumberId(data.meta_phone_number_id || '');
      setMetaBusinessAccountId(data.meta_business_account_id || '');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!entityId.trim()) {
      toast.error('Entity ID is required');
      return;
    }

    if (!metaApiKey.trim()) {
      toast.error('Meta API key is required');
      return;
    }

    if (!metaPhoneNumberId.trim()) {
      toast.error('Meta phone number ID is required');
      return;
    }

    setSaving(true);
    try {
      const data = await api.createWhatsAppSession({
        entityId: entityId.trim(),
        entityName: entityName.trim() || undefined,
        metaApiKey: metaApiKey.trim(),
        metaPhoneNumberId: metaPhoneNumberId.trim(),
        metaBusinessAccountId: metaBusinessAccountId.trim() || undefined,
      });
      setSession(data);
      setMetaApiKey('');
      toast.success('Meta WhatsApp session saved');
      loadSessions();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(eid) {
    const targetId = eid || entityId.trim();
    if (!targetId) return;

    if (!confirm('Disconnect this WhatsApp session?')) return;

    try {
      await api.deleteWhatsAppSession(targetId);
      if (view === 'detail') {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'disconnected',
              }
            : null,
        );
      }
      toast.success('Session disconnected');
      loadSessions();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleSendTest() {
    if (!entityId.trim()) {
      toast.error('Entity ID is required');
      return;
    }

    const digitsOnly = sanitizePhone(testPhone.trim());
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      toast.error('Phone must be 7-15 digits in international format (e.g. 919876543210)');
      return;
    }

    setSending(true);
    try {
      await api.sendWhatsAppTestMessage(
        entityId.trim(),
        digitsOnly,
        testMessage.trim() || undefined,
      );
      toast.success(`Test message sent to +${digitsOnly}`);
      setTestMessage('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  if (view === 'list') {
    const activeCount = sessions.filter((s) => s.status === 'active').length;

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">WhatsApp Sessions</h2>
            <p className="text-sm text-gray-500">
              {sessions.length === 0
                ? 'No sessions yet - add Meta credentials to get started'
                : `${sessions.length} session${sessions.length !== 1 ? 's' : ''} · ${activeCount} active`}
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

        <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-5 py-3">
          <ShieldCheck size={16} className="text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700">
            BlueMQ now uses Meta WhatsApp Cloud API only. Configure credentials per entity to isolate accounts safely.
          </p>
        </div>

        {sessions.length === 0 && !listLoading ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-50">
              <MessageSquare size={28} className="text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-800">No WhatsApp sessions</h3>
            <p className="mt-1 text-sm text-gray-500">
              Add Meta API credentials for an entity to activate WhatsApp delivery.
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
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                      meta
                    </span>
                    {s.status !== 'not_configured' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(s.entity_id);
                        }}
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

  const statusInfo = STATUS_STYLES[session?.status] || STATUS_STYLES.not_configured;
  const StatusIcon = statusInfo.icon;

  return (
    <div className="mx-auto max-w-xl space-y-6">
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
        <p className="text-sm text-gray-500">Manage Meta WhatsApp credentials for this entity</p>
      </div>

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
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Entity Name</label>
            <input
              type="text"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              placeholder="My Coaching Center"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Meta API Key <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={metaApiKey}
              onChange={(e) => setMetaApiKey(e.target.value)}
              placeholder="EA..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
            <p className="mt-1 text-xs text-gray-400">Only last 6 characters are shown after save.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Phone Number ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={metaPhoneNumberId}
              onChange={(e) => setMetaPhoneNumberId(e.target.value)}
              placeholder="123456789012345"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Business Account ID (optional)</label>
          <input
            type="text"
            value={metaBusinessAccountId}
            onChange={(e) => setMetaBusinessAccountId(e.target.value)}
            placeholder="987654321012345"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
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
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Save Meta Session
          </button>
        </div>
      </div>

      {session && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className={`flex items-center justify-between border-b px-6 py-4 ${statusInfo.bg}`}>
            <div className="flex items-center gap-3">
              <StatusIcon className={`h-5 w-5 ${statusInfo.color}`} />
              <div>
                <p className="text-sm font-semibold text-gray-800">{statusInfo.label}</p>
                <p className="text-xs text-gray-500">Provider: Meta WhatsApp Cloud API</p>
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

          <div className="p-6 space-y-3">
            {session.phone_number ? (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Smartphone size={15} className="text-green-500" />
                <span className="font-medium">+{session.phone_number}</span>
                <span className="text-xs text-gray-400">(WhatsApp number)</span>
              </div>
            ) : (
              <div className="text-xs text-gray-500">Phone number will appear after successful sends.</div>
            )}

            {session.connected_at && (
              <p className="text-xs text-gray-400">
                Connected {new Date(session.connected_at).toLocaleString()}
              </p>
            )}

            {session.meta_phone_number_id && (
              <p className="flex items-center gap-1.5 text-xs text-gray-500">
                <Phone size={12} /> Phone Number ID: <span className="font-medium">{session.meta_phone_number_id}</span>
              </p>
            )}

            {session.meta_business_account_id && (
              <p className="flex items-center gap-1.5 text-xs text-gray-500">
                <Building2 size={12} /> Business Account ID: <span className="font-medium">{session.meta_business_account_id}</span>
              </p>
            )}

            {session.meta_api_key && (
              <p className="flex items-center gap-1.5 text-xs text-gray-500">
                <KeyRound size={12} /> Saved API Key: <span className="font-medium">{session.meta_api_key}</span>
              </p>
            )}

            {session.status === 'active' && (
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
                        (international digits, no +, e.g. 919876543210)
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
                      Message <span className="font-normal text-gray-400">(optional)</span>
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
                    {sending ? <RefreshCw size={14} className="animate-spin" /> : <MessageSquare size={14} />}
                    {sending ? 'Sending...' : 'Send Test Message'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
