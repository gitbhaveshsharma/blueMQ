/**
 * Simple template rendering: replace {{variable}} with values.
 *
 * @param {string} text — e.g. "Hi {{student_name}}, your fee of {{amount}} is due"
 * @param {object} variables — e.g. { student_name: "Rahul", amount: "₹5,000" }
 * @returns {string}
 */
function renderTemplate(text, variables = {}) {
  if (!text) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

module.exports = { renderTemplate };
