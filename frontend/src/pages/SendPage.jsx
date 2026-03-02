import { useState } from 'react';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Send, Plus, Minus } from 'lucide-react';

const CHANNELS = ['push', 'email', 'sms', 'whatsapp', 'inapp'];

export default function SendPage() {
  const [form, setForm] = useState({
    user_id: '',
    type: '',
    channels: ['push'],
    entity_id: '',
    action_url: '',
    email: '',
    phone: '',
    onesignal_player_id: '',
  });
  const [variables, setVariables] = useState([{ key: '', value: '' }]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  function toggleChannel(ch) {
    setForm((prev) => ({
      ...prev,
      channels: prev.channels.includes(ch)
        ? prev.channels.filter((c) => c !== ch)
        : [...prev.channels, ch],
    }));
  }

  function updateVariable(index, field, value) {
    setVariables((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v))
    );
  }

  function addVariable() {
    setVariables((prev) => [...prev, { key: '', value: '' }]);
  }

  function removeVariable(index) {
    setVariables((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSend(e) {
    e.preventDefault();

    if (!form.user_id.trim() || !form.type.trim() || form.channels.length === 0) {
      toast.error('User ID, Type, and at least one channel are required');
      return;
    }

    // Build variables object
    const vars = {};
    variables.forEach(({ key, value }) => {
      if (key.trim()) vars[key.trim()] = value;
    });

    // Build user object
    const user = {};
    if (form.email.trim()) user.email = form.email.trim();
    if (form.phone.trim()) user.phone = form.phone.trim();
    if (form.onesignal_player_id.trim())
      user.onesignal_player_id = form.onesignal_player_id.trim();

    const payload = {
      user_id: form.user_id.trim(),
      type: form.type.trim(),
      channels: form.channels,
      variables: Object.keys(vars).length > 0 ? vars : undefined,
      user,
      action_url: form.action_url.trim() || undefined,
      entity_id: form.entity_id.trim() || undefined,
    };

    setSending(true);
    setResult(null);
    try {
      const data = await api.sendNotification(payload);
      setResult(data);
      toast.success('Notification enqueued!');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Send Notification</h2>
        <p className="text-sm text-gray-500">
          Compose and send a notification across multiple channels
        </p>
      </div>

      <form
        onSubmit={handleSend}
        className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5"
      >
        {/* User ID + Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              User ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.user_id}
              onChange={(e) => setForm({ ...form, user_id: e.target.value })}
              placeholder="user_123"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Type <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              placeholder="fee_due"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        {/* Channels */}
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Channels <span className="text-red-500">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => toggleChannel(ch)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  form.channels.includes(ch)
                    ? 'bg-indigo-600 text-white'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        {/* User fields */}
        <fieldset className="space-y-4 rounded-lg border border-gray-200 p-4">
          <legend className="px-2 text-sm font-medium text-gray-600">
            User Delivery Info
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="user@example.com"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Phone (E.164)
              </label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+919876543210"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                OneSignal Player ID
              </label>
              <input
                type="text"
                value={form.onesignal_player_id}
                onChange={(e) =>
                  setForm({ ...form, onesignal_player_id: e.target.value })
                }
                placeholder="abc-123-def"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Entity ID (WhatsApp)
              </label>
              <input
                type="text"
                value={form.entity_id}
                onChange={(e) =>
                  setForm({ ...form, entity_id: e.target.value })
                }
                placeholder="coaching_center_1"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
        </fieldset>

        {/* Action URL */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Action URL
          </label>
          <input
            type="url"
            value={form.action_url}
            onChange={(e) => setForm({ ...form, action_url: e.target.value })}
            placeholder="https://myapp.com/fee/123"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        {/* Variables */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Template Variables
            </label>
            <button
              type="button"
              onClick={addVariable}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <Plus size={14} />
              Add
            </button>
          </div>
          <div className="space-y-2">
            {variables.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={v.key}
                  onChange={(e) => updateVariable(i, 'key', e.target.value)}
                  placeholder="key"
                  className="w-1/3 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <input
                  type="text"
                  value={v.value}
                  onChange={(e) => updateVariable(i, 'value', e.target.value)}
                  placeholder="value"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                {variables.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeVariable(i)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                  >
                    <Minus size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={sending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={16} />
          {sending ? 'Sending...' : 'Send Notification'}
        </button>
      </form>

      {/* Result */}
      {result && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <p className="mb-2 text-sm font-medium text-green-800">
            Notification enqueued successfully
          </p>
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="font-medium text-green-700">Notification ID:</dt>
              <dd className="font-mono text-xs text-green-600">
                {result.notification_id}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-green-700">Channels:</dt>
              <dd className="text-green-600">
                {(result.channels_enqueued || []).join(', ')}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
