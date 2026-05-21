const BASE_URL = "/api";

/**
 * Centralized API client for BlueMQ backend.
 * All methods return parsed JSON or throw an error with a message.
 */
class ApiClient {
  #apiKey = "";

  setApiKey(key) {
    this.#apiKey = key;
  }

  getApiKey() {
    return this.#apiKey;
  }

  async #request(method, path, { body, params, auth = "app" } = {}) {
    const url = new URL(`${BASE_URL}${path}`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, v);
        }
      });
    }

    const headers = { "Content-Type": "application/json" };

    if (auth === "app") {
      headers["x-api-key"] = this.#apiKey;
    }

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }

    return data;
  }

  // ── Health ──
  health() {
    return this.#request("GET", "/health", { auth: "none" });
  }

  // ── App profile ──
  getAppProfile() {
    return this.#request("GET", "/apps/me");
  }

  // ── Auth (OTP-based) ──
  registerSendOtp(email, appName, appId) {
    return this.#request("POST", "/auth/register/send-otp", {
      body: { email, app_name: appName, app_id: appId },
      auth: "none",
    });
  }

  registerVerifyOtp(email, code) {
    return this.#request("POST", "/auth/register/verify-otp", {
      body: { email, code },
      auth: "none",
    });
  }

  loginSendOtp(email) {
    return this.#request("POST", "/auth/login/send-otp", {
      body: { email },
      auth: "none",
    });
  }

  loginVerifyOtp(email, code) {
    return this.#request("POST", "/auth/login/verify-otp", {
      body: { email, code },
      auth: "none",
    });
  }

  // ── Templates ──
  getTemplates({ type, channel } = {}) {
    return this.#request("GET", "/templates", { params: { type, channel } });
  }

  getTemplate(id) {
    return this.#request("GET", `/templates/${id}`);
  }

  createTemplate(data) {
    return this.#request("POST", "/templates", { body: data });
  }

  updateTemplate(id, data) {
    return this.#request("PUT", `/templates/${id}`, { body: data });
  }

  deleteTemplate(id) {
    return this.#request("DELETE", `/templates/${id}`);
  }

  // ── Notify ──
  sendNotification(data) {
    return this.#request("POST", "/notify", { body: data });
  }

  // ── Notifications ──
  getNotifications(userId, { page = 1, limit = 20 } = {}) {
    return this.#request("GET", `/notifications/${userId}`, {
      params: { page, limit },
    });
  }

  markAsRead(notificationId) {
    return this.#request("PATCH", `/notifications/${notificationId}/read`);
  }

  markAllRead(userId) {
    return this.#request("POST", `/notifications/${userId}/read-all`);
  }

  getDeliveryLogs(notificationId) {
    return this.#request("GET", `/notifications/${notificationId}/logs`);
  }

  getAppNotificationLogs({
    page = 1,
    limit = 20,
    search,
    channel,
    status,
    provider,
    from,
    to,
    days,
  } = {}) {
    return this.#request("GET", "/notifications/logs/app", {
      params: {
        page,
        limit,
        search,
        channel,
        status,
        provider,
        from,
        to,
        days,
      },
    });
  }

  // ── WhatsApp Sessions ──
  createWhatsAppSession({
    entityId,
    entityName,
    metaApiKey,
    metaPhoneNumberId,
    metaBusinessAccountId,
  }) {
    return this.#request("POST", "/whatsapp/sessions", {
      body: {
        entity_id: entityId,
        entity_name: entityName,
        connection_type: "meta",
        meta_api_key: metaApiKey,
        meta_phone_number_id: metaPhoneNumberId,
        meta_business_account_id: metaBusinessAccountId,
      },
    });
  }

  listWhatsAppSessions(status) {
    return this.#request("GET", "/whatsapp/sessions", {
      params: { status },
    });
  }

  getWhatsAppSession(entityId) {
    return this.#request("GET", `/whatsapp/sessions/${entityId}`);
  }

  deleteWhatsAppSession(entityId) {
    return this.#request("DELETE", `/whatsapp/sessions/${entityId}`);
  }

  sendWhatsAppTestMessage(entityId, phone, message) {
    return this.#request(
      "POST",
      `/whatsapp/sessions/${entityId}/test-message`,
      {
        body: { phone, message },
      },
    );
  }

  // ── Settings / Credentials ──
  getCredentials() {
    return this.#request("GET", "/settings/credentials");
  }

  updateCredentials(data) {
    return this.#request("PUT", "/settings/credentials", { body: data });
  }

  // ── Schedule Settings ──
  getScheduleSettings() {
    return this.#request("GET", "/settings/schedule");
  }

  updateScheduleSettings(data) {
    return this.#request("PATCH", "/settings/schedule", { body: data });
  }

  // ── Schedules ──
  getSchedules({ status, type } = {}) {
    return this.#request("GET", "/schedules", { params: { status, type } });
  }

  getSchedule(id) {
    return this.#request("GET", `/schedules/${id}`);
  }

  createSchedule(data) {
    return this.#request("POST", "/schedules", { body: data });
  }

  updateSchedule(id, data) {
    return this.#request("PATCH", `/schedules/${id}`, { body: data });
  }

  deleteSchedule(id) {
    return this.#request("DELETE", `/schedules/${id}`);
  }

  triggerSchedule(id) {
    return this.#request("POST", `/schedules/${id}/trigger`);
  }

  getScheduleLogs(id, { page = 1, limit = 20 } = {}) {
    return this.#request("GET", `/schedules/${id}/logs`, {
      params: { page, limit },
    });
  }
}

export const api = new ApiClient();
