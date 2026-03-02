import { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Copy, Check, Mail, ArrowLeft } from 'lucide-react';

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export default function RegisterPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  // ── Step: 'form' → 'otp' → 'success' ──
  const [step, setStep] = useState('form');

  // Form fields
  const [email, setEmail] = useState('');
  const [appName, setAppName] = useState('');
  const [loading, setLoading] = useState(false);

  // OTP fields
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [verifying, setVerifying] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const inputRefs = useRef([]);

  // Success
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const appId = slugify(appName);

  // ── Resend cooldown timer ──
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  // ── Step 1: Send OTP ──
  async function handleSendOtp(e) {
    e?.preventDefault();

    if (!email.trim()) {
      toast.error('Email is required');
      return;
    }
    if (!appName.trim()) {
      toast.error('App Name is required');
      return;
    }
    if (!appId) {
      toast.error('App Name must contain at least one letter or number');
      return;
    }

    setLoading(true);
    try {
      await api.registerSendOtp(email.trim(), appName.trim(), appId);
      toast.success('OTP sent to your email');
      setStep('otp');
      setResendTimer(60);
      // Focus first OTP input after transition
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── OTP input handler ──
  function handleOtpChange(index, value) {
    if (!/^\d*$/.test(value)) return; // digits only

    const next = [...otp];
    next[index] = value.slice(-1); // single digit
    setOtp(next);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 filled
    if (value && index === 5 && next.every((d) => d)) {
      verifyOtp(next.join(''));
    }
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      e.preventDefault();
      const next = pasted.split('');
      setOtp(next);
      inputRefs.current[5]?.focus();
      verifyOtp(pasted);
    }
  }

  // ── Step 2: Verify OTP ──
  async function verifyOtp(code) {
    setVerifying(true);
    try {
      const data = await api.registerVerifyOtp(email.trim(), code);
      setResult(data);
      setStep('success');
      toast.success('App registered successfully!');
    } catch (err) {
      toast.error(err.message);
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } finally {
      setVerifying(false);
    }
  }

  function handleVerifySubmit(e) {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) {
      toast.error('Enter the 6-digit code');
      return;
    }
    verifyOtp(code);
  }

  // ── Resend OTP ──
  async function handleResend() {
    if (resendTimer > 0) return;
    setLoading(true);
    try {
      await api.registerSendOtp(email.trim(), appName.trim(), appId);
      toast.success('New OTP sent');
      setResendTimer(60);
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Success actions ──
  function handleCopyKey() {
    navigator.clipboard.writeText(result.api_key);
    setCopied(true);
    toast.success('API key copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }

  function handleConnect() {
    login(result.api_key, result.app_id, result.app_name, email.trim());
    toast.success('Connected to BlueMQ');
    navigate('/dashboard');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white shadow-lg">
            B
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {step === 'form' && 'Register App'}
            {step === 'otp' && 'Verify Email'}
            {step === 'success' && 'App Created'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {step === 'form' && 'Create a new app on your BlueMQ instance'}
            {step === 'otp' && `Enter the code sent to ${email}`}
            {step === 'success' && 'Save your API key — it is shown only once'}
          </p>
        </div>

        {/* ── Step 1: Email + App Name ── */}
        {step === 'form' && (
          <form
            onSubmit={handleSendOtp}
            className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
          >
            <div className="space-y-5">
              {/* Email */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoFocus
                    className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  We'll send a verification code to this email
                </p>
              </div>

              {/* App Name */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  App Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="My Application"
                  className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {/* Generated App ID preview */}
              {appId && (
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5">
                  <p className="text-xs font-medium text-gray-500">
                    Generated App ID
                  </p>
                  <p className="mt-0.5 font-mono text-sm text-gray-800">
                    {appId}
                  </p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Sending OTP...' : 'Send Verification Code'}
            </button>

            <p className="mt-4 text-center text-xs text-gray-400">
              Already have an account?{' '}
              <Link to="/login" className="text-indigo-600 hover:underline">
                Login
              </Link>
            </p>
          </form>
        )}

        {/* ── Step 2: OTP Verification ── */}
        {step === 'otp' && (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <form onSubmit={handleVerifySubmit}>
              {/* OTP Inputs */}
              <div className="flex justify-center gap-3" onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => (inputRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="h-12 w-11 rounded-lg border border-gray-300 text-center text-lg font-semibold shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={verifying || otp.join('').length < 6}
                className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {verifying ? 'Verifying...' : 'Verify & Register'}
              </button>
            </form>

            {/* Resend + Back */}
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStep('form');
                  setOtp(['', '', '', '', '', '']);
                }}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                <ArrowLeft size={12} />
                Back
              </button>

              <button
                type="button"
                onClick={handleResend}
                disabled={resendTimer > 0 || loading}
                className="text-xs font-medium text-indigo-600 hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
              >
                {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend code'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Success ── */}
        {step === 'success' && result && (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-medium text-green-800">
                App registered successfully!
              </p>
              <p className="mt-1 text-xs text-green-600">
                Save your API key — it is shown only once.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  App ID
                </label>
                <p className="text-sm font-mono text-gray-800">
                  {result.app_id}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  API Key
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs break-all">
                    {result.api_key}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyKey}
                    className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    {copied ? (
                      <Check size={16} className="text-green-500" />
                    ) : (
                      <Copy size={16} />
                    )}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleConnect}
              className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-colors"
            >
              Connect with this key
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

