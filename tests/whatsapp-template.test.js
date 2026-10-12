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

  test("maps template with dynamic URL button from example and variables", () => {
    const components = [
      {
        type: "BODY",
        text: "Hello {{1}} at {{2}}, date {{3}}, subject {{4}}, class {{5}}, status {{6}}, by {{7}}, branch {{8}}",
        example: {
          body_text: [
            [
              "student_name",
              "coaching_center_name",
              "attendance_date",
              "subject",
              "class_name",
              "attendance_status",
              "teacher_name",
              "branch_name",
            ],
          ],
        },
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "View My Attendance",
            url: "https://mentoracity.com/lms/student/%7B%7B1%7D%7D/attendance{{1}}",
          },
        ],
      },
    ];

    const normalized = normalizeWhatsAppVariables(components, {
      student_name: "Bhavesh",
      coaching_center_name: "Tutrsy",
      attendance_date: "2026-10-06",
      subject: "Hindi",
      class_name: "10th Hindi",
      attendance_status: "PRESENT",
      teacher_name: "Bhavesh Sharma",
      branch_name: "Main Branch",
      action_url: "/lms/student/123/attendance",
    });

    expect(normalized.missing).toEqual([]);
    expect(normalized.variables.whatsapp).toHaveLength(9);
    expect(normalized.variables.whatsapp[0]).toBe("Bhavesh");
    expect(normalized.variables.whatsapp[7]).toBe("Main Branch");
    expect(normalized.variables.whatsapp[8]).toBe("/lms/student/123/attendance");

    const sendComponents = buildTemplateSendComponents(
      components,
      normalized.variables,
    );
    expect(sendComponents).toHaveLength(2);
    expect(sendComponents[0].type).toBe("body");
    expect(sendComponents[0].parameters).toHaveLength(8);
    expect(sendComponents[1].type).toBe("button");
    expect(sendComponents[1].parameters[0].text).toBe(
      "/lms/student/123/attendance",
    );
  });

  test("maps user attendance variables properly to live Meta template components", () => {
    const components = [
      {
        type: "BODY",
        text: "Hello {{1}},\n\nYour attendance has been recorded at *{{2}}*.\n\nDate: {{3}}\nSubject: {{4}}\nClass: {{5}}\nStatus: *{{6}}*\nMarked by: {{7}}\nBranch: {{8}} - Thank you!",
        example: {
          body_text: [
            [
              "student_name",
              "coaching_center_name",
              "attendance_date",
              "subject",
              "class_name",
              "attendance_status",
              "teacher_name",
              "branch_name",
            ],
          ],
        },
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "View My Attendance",
            url: "https://mentoracity.com/lms/student/%7B%7B1%7D%7D/attendance{{1}}",
          },
        ],
      },
    ];

    const userVariables = {
      actionUrl: "/lms/student/38df114c-1f4e-4065-950b-0b0e2db0380c/attendance",
      action_url: "/lms/student/38df114c-1f4e-4065-950b-0b0e2db0380c/attendance",
      attendance_action: "marked",
      attendance_date: "2026-10-06",
      attendance_status: "PRESENT",
      branch_name: "Main Campus",
      class_name: "Physics Intermediate",
      coaching_center_name: "Tutrsy",
      late_by_minutes: "0",
      student_name: "Bhavesh",
      subject: "Physics",
      teacher_name: "Ranjeet Kumar",
      teacher_remarks: "On time",
    };

    const normalized = normalizeWhatsAppVariables(components, userVariables);
    expect(normalized.missing).toEqual([]);
    expect(normalized.variables.whatsapp).toEqual([
      "Bhavesh",
      "Tutrsy",
      "2026-10-06",
      "Physics",
      "Physics Intermediate",
      "PRESENT",
      "Ranjeet Kumar",
      "Main Campus",
      "/lms/student/38df114c-1f4e-4065-950b-0b0e2db0380c/attendance",
    ]);

    const sendComponents = buildTemplateSendComponents(
      components,
      normalized.variables,
    );
    expect(sendComponents).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Bhavesh" },
          { type: "text", text: "Tutrsy" },
          { type: "text", text: "2026-10-06" },
          { type: "text", text: "Physics" },
          { type: "text", text: "Physics Intermediate" },
          { type: "text", text: "PRESENT" },
          { type: "text", text: "Ranjeet Kumar" },
          { type: "text", text: "Main Campus" },
        ],
      },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [
          {
            type: "text",
            text: "/lms/student/38df114c-1f4e-4065-950b-0b0e2db0380c/attendance",
          },
        ],
      },
    ]);
  });
});

