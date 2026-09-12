export const AUDIENCE_MEMBER_FIELDS = Object.freeze([
  {
    key: "email",
    label: "Email",
    type: "email",
    placeholder: "user@example.com",
  },
  {
    key: "phone",
    label: "Phone (E.164)",
    type: "text",
    placeholder: "+919876543210",
  },
  {
    key: "fcm_token",
    label: "FCM Token",
    type: "text",
    placeholder: "fcm-device-token",
  },
  {
    key: "onesignal_player_id",
    label: "OneSignal Player ID",
    type: "text",
    placeholder: "player-id",
  },
  {
    key: "entity_id",
    label: "Entity ID (WhatsApp)",
    type: "text",
    placeholder: "whatsapp-entity-id",
  },
]);

export const EMPTY_AUDIENCE_MEMBER = Object.freeze(
  Object.fromEntries(AUDIENCE_MEMBER_FIELDS.map(({ key }) => [key, ""])),
);

export function hasAudienceDeliveryAddress(member) {
  return Boolean(
    member?.email ||
      member?.phone ||
      member?.fcm_token ||
      member?.onesignal_player_id,
  );
}
