const {
  normalizeWhatsAppVariables,
  buildTemplateSendComponents,
} = require("../src/utils/whatsapp-template");

describe("WhatsApp template variable mapping", () => {
  test("maps Meta body example labels to positional values", () => {
    const components = [
      {
        type: "BODY",
        text: "{{1}} {{2}} {{3}} {{4}} {{5}}",
        example: {
          body_text: [
            [
              "student_name",
              "class_name",
              "subject",
              "attendance_date",
              "attendance_status",
            ],
          ],
        },
      },
    ];

    const result = normalizeWhatsAppVariables(components, {
      student_name: "Student",
      class_name: "Class",
      subject: "Physics",
      attendance_date: "2026-10-03",
      attendance_status: "PRESENT",
    });

    expect(result.variables.whatsapp).toEqual([
      "Student",
      "Class",
      "Physics",
      "2026-10-03",
      "PRESENT",
    ]);
    expect(result.missing).toEqual([]);
  });

  test("keeps explicit positional values authoritative", () => {
    const components = [
      {
        type: "BODY",
        text: "{{1}} {{2}}",
        example: { body_text: [["first_name", "status"]] },
      },
    ];

    const result = normalizeWhatsAppVariables(components, {
      first_name: "Named",
      whatsapp: ["Explicit", "Ready"],
    });

    expect(result.variables.whatsapp).toEqual(["Explicit", "Ready"]);
    expect(result.missing).toEqual([]);
  });

  test("reports missing mapped values before Meta is called", () => {
    const components = [
      {
        type: "BODY",
        text: "{{1}} {{2}}",
        example: { body_text: [["first_name", "status"]] },
      },
    ];

    const result = normalizeWhatsAppVariables(components, {
      first_name: "Named",
    });

    expect(result.missing).toEqual([{ index: 2, variable: "status" }]);
  });

  test("builds Meta body parameters from mapped values", () => {
    const components = [
      {
        type: "BODY",
        text: "Hello {{1}}",
        example: { body_text: [["student_name"]] },
      },
    ];
    const normalized = normalizeWhatsAppVariables(components, {
      student_name: "Student",
    });

    expect(
      buildTemplateSendComponents(components, normalized.variables),
    ).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Student" }] },
    ]);
  });
});
