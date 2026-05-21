import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowLeft, Clock, RefreshCw, Save } from "lucide-react";
import { api } from "../services/api";

const FREQUENCIES = ["daily", "weekly", "monthly", "custom_cron"];
const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [
      "UTC",
      "America/New_York",
      "Europe/London",
      "Asia/Kolkata",
      "Asia/Tokyo",
    ];
  }
})();

const EMPTY_FORM = {
  type: "one_time",
  template_key: "",
  data_source_url: "",
  data_source_secret: "",
  audience: "{}",
  created_by: "",
  max_retries: "",
  timezone: "",
  run_at: "",
  frequency: "daily",
  time_of_day: "09:00",
  day_of_week: 1,
  day_of_month: 1,
  cron_expression: "",
};

function normalizeFormFromSchedule(schedule) {
  return {
    type: schedule.type || "one_time",
    template_key: schedule.template_key || "",
    data_source_url: schedule.data_source_url || "",
    data_source_secret: "",
    audience: schedule.audience
      ? JSON.stringify(schedule.audience, null, 2)
      : "{}",
    created_by: schedule.created_by || "",
    max_retries: schedule.max_retries ?? "",
    timezone: schedule.timezone || "",
    run_at: schedule.run_at
      ? new Date(schedule.run_at).toISOString().slice(0, 16)
      : "",
    frequency: schedule.frequency || "daily",
    time_of_day: schedule.time_of_day
      ? schedule.time_of_day.substring(0, 5)
      : "09:00",
    day_of_week: schedule.day_of_week ?? 1,
    day_of_month: schedule.day_of_month ?? 1,
    cron_expression: schedule.cron_expression || "",
  };
}

export default function ScheduleEditorPage() {
  const navigate = useNavigate();
  const { scheduleId } = useParams();
  const isEditing = Boolean(scheduleId);

  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (!isEditing) return;

    let cancelled = false;
    async function loadSchedule() {
      setLoading(true);
      try {
        const response = await api.getSchedule(scheduleId);
        if (!cancelled) {
          setForm(normalizeFormFromSchedule(response.data));
        }
      } catch (error) {
        toast.error(`Failed to load schedule: ${error.message}`);
        navigate("/schedules", { replace: true });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSchedule();
    return () => {
      cancelled = true;
    };
  }, [isEditing, navigate, scheduleId]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);

    try {
      let audienceParsed;
      try {
        audienceParsed = JSON.parse(form.audience);
      } catch {
        toast.error("Audience must be valid JSON");
        setSaving(false);
        return;
      }

      const payload = {
        type: form.type,
        template_key: form.template_key,
        data_source_url: form.data_source_url,
        audience: audienceParsed,
      };

      if (form.data_source_secret) {
        payload.data_source_secret = form.data_source_secret;
      } else if (!isEditing) {
        payload.data_source_secret = form.data_source_secret;
      }

      if (form.created_by) payload.created_by = form.created_by;
      if (form.max_retries !== "") {
        payload.max_retries = parseInt(form.max_retries, 10);
      }
      if (form.timezone) payload.timezone = form.timezone;

      if (form.type === "one_time") {
        payload.run_at = new Date(form.run_at).toISOString();
      } else {
        payload.frequency = form.frequency;
        if (form.frequency !== "custom_cron") {
          payload.time_of_day = form.time_of_day;
        }
        if (form.frequency === "weekly") {
          payload.day_of_week = parseInt(form.day_of_week, 10);
        }
        if (form.frequency === "monthly") {
          payload.day_of_month = parseInt(form.day_of_month, 10);
        }
        if (form.frequency === "custom_cron") {
          payload.cron_expression = form.cron_expression;
        }
      }

      if (isEditing) {
        await api.updateSchedule(scheduleId, payload);
        toast.success("Schedule updated");
      } else {
        await api.createSchedule(payload);
        toast.success("Schedule created");
      }

      navigate("/schedules");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate("/schedules")}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            Back to schedules
          </button>
          <span className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
            <Clock size={14} className="text-indigo-500" />
            Scheduled Notifications
          </span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {isEditing ? "Edit Schedule" : "Create Schedule"}
          </h2>
          <p className="text-sm text-gray-500">
            Set timing, data source, and audience details for this schedule.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Schedule Type
            </label>
            <div className="flex flex-wrap gap-2">
              {["one_time", "recurring"].map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={isEditing}
                  onClick={() => set("type", t)}
                  className={`rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                    form.type === t
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {t === "one_time" ? "One-Time" : "Recurring"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Template Key <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.template_key}
                onChange={(e) => set("template_key", e.target.value)}
                placeholder="e.g. fee_reminder, attendance_summary"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-300 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Created By
              </label>
              <input
                type="text"
                value={form.created_by}
                onChange={(e) => set("created_by", e.target.value)}
                placeholder="admin@example.com"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-300 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Data Source URL <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              required
              value={form.data_source_url}
              onChange={(e) => set("data_source_url", e.target.value)}
              placeholder="https://your-app.com/api/bluemq/schedule-data"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-mono text-gray-800 placeholder:text-gray-300 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Data Source Secret {isEditing ? "(leave blank to keep)" : "*"}
            </label>
            <input
              type="password"
              required={!isEditing}
              value={form.data_source_secret}
              onChange={(e) => set("data_source_secret", e.target.value)}
              placeholder="HMAC signing secret"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-mono text-gray-800 placeholder:text-gray-300 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Audience (JSON) <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={4}
              value={form.audience}
              onChange={(e) => set("audience", e.target.value)}
              placeholder='{"group": "all_students"}'
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-mono text-gray-800 placeholder:text-gray-300 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
            />
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          {form.type === "one_time" ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Run At (date & time) <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                required
                value={form.run_at}
                onChange={(e) => set("run_at", e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Frequency <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.frequency}
                    onChange={(e) => set("frequency", e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {f === "custom_cron"
                          ? "Custom Cron"
                          : f.charAt(0).toUpperCase() + f.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                {form.frequency !== "custom_cron" && (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Time of Day <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="time"
                      value={form.time_of_day}
                      onChange={(e) => set("time_of_day", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                    />
                  </div>
                )}
              </div>

              {form.frequency === "weekly" && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Day of Week <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={form.day_of_week}
                      onChange={(e) => set("day_of_week", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                    >
                      {DAYS_OF_WEEK.map((d, i) => (
                        <option key={i} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {form.frequency === "monthly" && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Day of Month (1-28){" "}
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={form.day_of_month}
                      onChange={(e) => set("day_of_month", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                    />
                  </div>
                </div>
              )}

              {form.frequency === "custom_cron" && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Cron Expression <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.cron_expression}
                    onChange={(e) => set("cron_expression", e.target.value)}
                    placeholder="*/5 * * * *"
                    className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-mono text-gray-800 placeholder:text-gray-300 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
                  />
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Timezone
              </label>
              <select
                value={form.timezone}
                onChange={(e) => set("timezone", e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
              >
                <option value="">Use default</option>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Max Retries
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={form.max_retries}
                onChange={(e) => set("max_retries", e.target.value)}
                placeholder="Use default"
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-300 focus:border-indigo-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
              />
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate("/schedules")}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving
              ? "Saving..."
              : isEditing
                ? "Update Schedule"
                : "Create Schedule"}
          </button>
        </div>
      </form>
    </div>
  );
}
