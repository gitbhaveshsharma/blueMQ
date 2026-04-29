import { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  Settings,
  RefreshCw,
  Save,
  Shield,
  Flame,
  Bell,
  Mail,
  MessageSquare,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// ─── Provider option definitions ───
const PUSH_PROVIDERS = [
  { value: 'firebase', label: 'Firebase Cloud Messaging', icon: Flame, color: 'text-orange-500' },
  { value: 'onesignal', label: 'OneSignal', icon: Bell, color: 'text-indigo-500' },
];

const EMAIL_PROVIDERS = [
  { value: 'resend', label: 'Resend', icon: Mail, color: 'text-emerald-500' },
  { value: 'onesignal', label: 'OneSignal', icon: Bell, color: 'text-indigo-500' },
];

const SMS_PROVIDERS = [
  { value: 'onesignal', label: 'OneSignal', icon: MessageSquare, color: 'text-indigo-500' },
];

// ─── Helpers ───

function ProviderSelect({ label, channel, providers, value, onChange }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => {
          const Icon = p.icon;
          const isActive = value === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(channel, p.value)}
              className={`flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-sm font-medium transition-all duration-200
                ${isActive
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
            >
              <Icon size={16} className={isActive ? p.color : 'text-gray-400'} />
              {p.label}
              {isActive && <CheckCircle size={14} className="text-indigo-500" />}
            </button>
          );
        })}
        {value && (
          <button
            type="button"
            onClick={() => onChange(channel, null)}
            className="rounded-xl border-2 border-dashed border-gray-200 px-4 py-2.5 text-sm text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-all duration-200"
          >
            Use Server Default
          </button>
        )}
      </div>
    </div>
  );
}

function SecretInput({ label, name, value, onChange, placeholder, multiline = false }) {
  const [show, setShow] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs font-medium text-gray-500">
        {label}
      </label>
      <div className="relative flex items-start gap-2">
        {multiline ? (
          <textarea
            id={name}
            name={name}
            value={value || ''}
            onChange={(e) => onChange(name, e.target.value)}
            placeholder={placeholder}
            rows={4}
            className={`flex-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-mono text-gray-800 placeholder:text-gray-300
              focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all
              ${!show && value ? 'text-security-disc' : ''}`}
            style={!show && value ? { WebkitTextSecurity: 'disc' } : {}}
          />
        ) : (
          <input
            id={name}
            name={name}
            type={show ? 'text' : 'password'}
            value={value || ''}
            onChange={(e) => onChange(name, e.target.value)}
            placeholder={placeholder}
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-mono text-gray-800 placeholder:text-gray-300
              focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
          />
        )}
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="shrink-0 mt-2.5 rounded-lg p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
          title={show ? 'Hide' : 'Show'}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function TextInput({ label, name, value, onChange, placeholder }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs font-medium text-gray-500">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="text"
        value={value || ''}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 placeholder:text-gray-300
          focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
      />
    </div>
  );
}

function CredentialSection({ title, icon: Icon, color, isOpen, onToggle, hasCredentials, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden transition-all duration-200">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-6 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
          <Icon size={18} className="text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="text-xs text-gray-400">
            {hasCredentials ? 'Credentials configured' : 'No credentials set — using server defaults'}
          </p>
        </div>
        {hasCredentials && <CheckCircle size={18} className="text-emerald-500 shrink-0" />}
        {isOpen ? (
          <ChevronDown size={18} className="text-gray-400" />
        ) : (
          <ChevronRight size={18} className="text-gray-400" />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-gray-100 px-6 py-5 space-y-4 animate-[fadeIn_0.2s_ease-in]">
          {children}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);

  // Provider routing
  const [providerPush, setProviderPush] = useState(null);
  const [providerEmail, setProviderEmail] = useState(null);
  const [providerSms, setProviderSms] = useState(null);

  // Credentials
  const [creds, setCreds] = useState({
    firebase_project_id: '',
    firebase_client_email: '',
    firebase_private_key: '',
    onesignal_app_id: '',
    onesignal_api_key: '',
    resend_api_key: '',
    resend_from_email: '',
  });

  // Existing credential indicators
  const [existingCreds, setExistingCreds] = useState({
    has_firebase_private_key: false,
    has_onesignal_api_key: false,
    has_resend_api_key: false,
  });

  // Section open states
  const [openSections, setOpenSections] = useState({
    firebase: true,
    onesignal: false,
    resend: false,
  });

  const toggleSection = (section) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const fetchCredentials = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getCredentials();
      setConfigured(data.configured);

      if (data.credentials) {
        const c = data.credentials;
        setProviderPush(c.provider_push || null);
        setProviderEmail(c.provider_email || null);
        setProviderSms(c.provider_sms || null);

        setCreds((prev) => ({
          ...prev,
          firebase_project_id: c.firebase_project_id || '',
          firebase_client_email: c.firebase_client_email || '',
          firebase_private_key: '', // Never pre-fill secrets
          onesignal_app_id: c.onesignal_app_id || '',
          onesignal_api_key: '',
          resend_api_key: '',
          resend_from_email: c.resend_from_email || '',
        }));

        setExistingCreds({
          has_firebase_private_key: c.has_firebase_private_key || false,
          has_onesignal_api_key: c.has_onesignal_api_key || false,
          has_resend_api_key: c.has_resend_api_key || false,
        });
      }
    } catch (err) {
      toast.error('Failed to load settings: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  function handleProviderChange(channel, value) {
    if (channel === 'push') setProviderPush(value);
    if (channel === 'email') setProviderEmail(value);
    if (channel === 'sms') setProviderSms(value);
  }

  function handleCredChange(name, value) {
    setCreds((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        provider_push: providerPush,
        provider_email: providerEmail,
        provider_sms: providerSms,
      };

      // Only send credential fields if they have values (don't overwrite with empty)
      if (creds.firebase_project_id) payload.firebase_project_id = creds.firebase_project_id;
      if (creds.firebase_client_email) payload.firebase_client_email = creds.firebase_client_email;
      if (creds.firebase_private_key) payload.firebase_private_key = creds.firebase_private_key;
      if (creds.onesignal_app_id) payload.onesignal_app_id = creds.onesignal_app_id;
      if (creds.onesignal_api_key) payload.onesignal_api_key = creds.onesignal_api_key;
      if (creds.resend_api_key) payload.resend_api_key = creds.resend_api_key;
      if (creds.resend_from_email) payload.resend_from_email = creds.resend_from_email;

      await api.updateCredentials(payload);
      toast.success('Provider settings saved successfully');
      await fetchCredentials();
    } catch (err) {
      toast.error('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Settings size={22} className="text-indigo-500" />
            Provider Settings
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure your notification provider credentials and routing preferences
          </p>
        </div>
        <button
          onClick={fetchCredentials}
          className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Status banner */}
      <div
        className={`flex items-center gap-3 rounded-xl border px-5 py-3.5 text-sm ${
          configured
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-700'
        }`}
      >
        {configured ? (
          <>
            <CheckCircle size={18} />
            Custom provider credentials are configured. Notifications will use your keys.
          </>
        ) : (
          <>
            <AlertCircle size={18} />
            No custom credentials configured. Server-level defaults will be used for all notifications.
          </>
        )}
      </div>

      {/* Provider Routing */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={18} className="text-indigo-500" />
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Provider Routing</h3>
        </div>
        <p className="text-xs text-gray-400 -mt-3">
          Choose which provider to use for each notification channel. Leave unset to use server defaults.
        </p>

        <ProviderSelect
          label="Push Notifications"
          channel="push"
          providers={PUSH_PROVIDERS}
          value={providerPush}
          onChange={handleProviderChange}
        />

        <ProviderSelect
          label="Email"
          channel="email"
          providers={EMAIL_PROVIDERS}
          value={providerEmail}
          onChange={handleProviderChange}
        />

        <ProviderSelect
          label="SMS"
          channel="sms"
          providers={SMS_PROVIDERS}
          value={providerSms}
          onChange={handleProviderChange}
        />
      </div>

      {/* Firebase Credentials */}
      <CredentialSection
        title="Firebase Cloud Messaging"
        icon={Flame}
        color="bg-orange-500"
        isOpen={openSections.firebase}
        onToggle={() => toggleSection('firebase')}
        hasCredentials={!!creds.firebase_project_id || existingCreds.has_firebase_private_key}
      >
        <p className="text-xs text-gray-400 mb-2">
          Get these from your{' '}
          <a
            href="https://console.firebase.google.com/"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-500 hover:underline"
          >
            Firebase Console
          </a>{' '}
          → Project Settings → Service Accounts → Generate new private key.
        </p>
        <TextInput
          label="Project ID"
          name="firebase_project_id"
          value={creds.firebase_project_id}
          onChange={handleCredChange}
          placeholder="my-project-id"
        />
        <TextInput
          label="Client Email"
          name="firebase_client_email"
          value={creds.firebase_client_email}
          onChange={handleCredChange}
          placeholder="firebase-adminsdk-xxxxx@my-project.iam.gserviceaccount.com"
        />
        <SecretInput
          label={`Private Key${existingCreds.has_firebase_private_key ? ' (already set — leave blank to keep)' : ''}`}
          name="firebase_private_key"
          value={creds.firebase_private_key}
          onChange={handleCredChange}
          placeholder="-----BEGIN PRIVATE KEY-----\n..."
          multiline
        />
      </CredentialSection>

      {/* OneSignal Credentials */}
      <CredentialSection
        title="OneSignal"
        icon={Bell}
        color="bg-indigo-500"
        isOpen={openSections.onesignal}
        onToggle={() => toggleSection('onesignal')}
        hasCredentials={!!creds.onesignal_app_id || existingCreds.has_onesignal_api_key}
      >
        <p className="text-xs text-gray-400 mb-2">
          Get these from your{' '}
          <a
            href="https://app.onesignal.com/"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-500 hover:underline"
          >
            OneSignal Dashboard
          </a>{' '}
          → Settings → Keys & IDs.
        </p>
        <TextInput
          label="App ID"
          name="onesignal_app_id"
          value={creds.onesignal_app_id}
          onChange={handleCredChange}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
        <SecretInput
          label={`API Key${existingCreds.has_onesignal_api_key ? ' (already set — leave blank to keep)' : ''}`}
          name="onesignal_api_key"
          value={creds.onesignal_api_key}
          onChange={handleCredChange}
          placeholder="os_v2_app_..."
        />
      </CredentialSection>

      {/* Resend Credentials */}
      <CredentialSection
        title="Resend (Email)"
        icon={Mail}
        color="bg-emerald-500"
        isOpen={openSections.resend}
        onToggle={() => toggleSection('resend')}
        hasCredentials={!!creds.resend_from_email || existingCreds.has_resend_api_key}
      >
        <p className="text-xs text-gray-400 mb-2">
          Get your API key from{' '}
          <a
            href="https://resend.com/api-keys"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-500 hover:underline"
          >
            Resend Dashboard
          </a>
          .
        </p>
        <SecretInput
          label={`API Key${existingCreds.has_resend_api_key ? ' (already set — leave blank to keep)' : ''}`}
          name="resend_api_key"
          value={creds.resend_api_key}
          onChange={handleCredChange}
          placeholder="re_..."
        />
        <TextInput
          label="From Email"
          name="resend_from_email"
          value={creds.resend_from_email}
          onChange={handleCredChange}
          placeholder="My App <noreply@mydomain.com>"
        />
      </CredentialSection>

      {/* Save button */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm
            hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2
            disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        >
          {saving ? (
            <RefreshCw size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Info note */}
      <div className="rounded-xl border border-gray-100 bg-gray-50 px-5 py-4 text-xs text-gray-400 space-y-1">
        <p>
          <strong className="text-gray-500">How it works:</strong> When you configure provider credentials here,
          BlueMQ will use your keys to send notifications. If no credentials are set, server-level defaults are used.
        </p>
        <p>
          <strong className="text-gray-500">WhatsApp:</strong> WhatsApp credentials are managed per-entity
          in the WhatsApp page and are not affected by these settings.
        </p>
      </div>
    </div>
  );
}
