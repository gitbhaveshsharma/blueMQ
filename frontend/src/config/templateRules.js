const JOIN_REQUEST_VARIABLES = Object.freeze([
  "join_request_id",
  "request_status",
  "requester_name",
  "requester_email",
  "requester_phone",
  "request_subject",
  "request_classes",
  "request_message",
  "branch_name",
  "coaching_center_name",
  "is_guest_request",
  "requested_at",
]);

export const TEMPLATE_RULE_PROFILES = Object.freeze({
  join_request_submitted: {
    id: "join_request_submitted",
    label: "Join request submitted",
    audience:
      "Branch manager -> Coaching center manager -> Coaching center owner (priority order, deduplicated)",
    sender: "Requester (authenticated user). Null for guest submissions.",
    contextNote:
      "Email header should use MentoraCity branding because recipients see this in platform context.",
    variables: JOIN_REQUEST_VARIABLES,
  },
  join_request_status_updated: {
    id: "join_request_status_updated",
    label: "Join request status updated",
    audience: "Requester",
    sender: "Platform/system",
    conditionKey: "request_status",
    variables: JOIN_REQUEST_VARIABLES,
    variants: [
      {
        conditionValue: "APPROVED",
        heroColor: "#10B981",
        notesStyle: "Admin notes in green card",
        defaultCtaText: "View Details",
      },
      {
        conditionValue: "REJECTED",
        heroColor: "#EF4444",
        notesStyle:
          'Use softer language (for example: "not accepted at this time"). Admin notes in amber card.',
        defaultCtaText: "Explore Other Centers",
      },
      {
        conditionValue: "CANCELLED",
        heroColor: "#6B7280",
        notesStyle:
          "Use neutral grey hero (no strong success/error semantic color).",
        defaultCtaText: "Explore Marketplace",
      },
    ],
  },
});

export const TEMPLATE_RULE_PROFILE_LIST = Object.freeze(
  Object.values(TEMPLATE_RULE_PROFILES),
);

export function getTemplateRuleProfile(type) {
  if (!type) return null;
  return TEMPLATE_RULE_PROFILES[String(type).trim().toLowerCase()] || null;
}
