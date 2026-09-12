const crypto = require("crypto");

const AUDIENCE_MEMBER_FIELDS = Object.freeze([
  "email",
  "phone",
  "fcm_token",
  "onesignal_player_id",
  "entity_id",
]);

const HEADER_ALIASES = Object.freeze({
  email: "email",
  phone: "phone",
  fcm_token: "fcm_token",
  fcmtoken: "fcm_token",
  fcm: "fcm_token",
  onesignal_player_id: "onesignal_player_id",
  onesignalplayerid: "onesignal_player_id",
  onesignal: "onesignal_player_id",
  entity_id: "entity_id",
  entityid: "entity_id",
});

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function normalizeAudienceMember(value) {
  const source = value && typeof value === "object" ? value : {};
  const member = Object.fromEntries(
    AUDIENCE_MEMBER_FIELDS.map((field) => [field, clean(source[field])]),
  );
  return {
    ...member,
    user_id: clean(source.user_id) || crypto.randomUUID(),
  };
}

function hasDeliveryAddress(member) {
  return Boolean(
    member.email ||
      member.phone ||
      member.fcm_token ||
      member.onesignal_player_id,
  );
}

// RFC 4180-compatible parser, intentionally small and dependency-free.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value !== "") || rows.length === 0) rows.push(row);
  return rows;
}

function parseAudienceImport(format, content) {
  if (format === "json") {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    if (!Array.isArray(parsed)) throw new Error("JSON import must be an array");
    return parsed;
  }

  if (format !== "csv") throw new Error("format must be csv or json");
  const rows = parseCsv(content);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) =>
    HEADER_ALIASES[
      String(header).trim().toLowerCase().replace(/[\s-]+/g, "_")
    ] || null,
  );
  if (!headers.some(Boolean)) {
    throw new Error(
      `CSV header must include: ${AUDIENCE_MEMBER_FIELDS.join(", ")}`,
    );
  }

  return rows.slice(1).filter((row) => row.some(clean)).map((row) => {
    const member = {};
    headers.forEach((field, index) => {
      if (field) member[field] = row[index] || "";
    });
    return member;
  });
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function membersToCsv(members) {
  return [
    AUDIENCE_MEMBER_FIELDS.join(","),
    ...members.map((member) =>
      AUDIENCE_MEMBER_FIELDS.map((field) => csvEscape(member[field])).join(","),
    ),
  ].join("\n");
}

module.exports = {
  AUDIENCE_MEMBER_FIELDS,
  normalizeAudienceMember,
  hasDeliveryAddress,
  parseAudienceImport,
  membersToCsv,
};
