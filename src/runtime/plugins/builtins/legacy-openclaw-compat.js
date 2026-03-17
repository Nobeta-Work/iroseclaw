/**
 * Builtin plugin: legacy OpenClaw compatibility planner
 */

const { LegacyOpenClawPlanner } = require('../../workflow/planners/legacy-openclaw-planner');

module.exports = {
  name: 'builtin-legacy-openclaw-compat',
  apply(host, context) {
    context.registerPlanner('legacy-openclaw', ({ getLegacyAdapter }) => new LegacyOpenClawPlanner({
      adapter: typeof getLegacyAdapter === 'function' ? getLegacyAdapter() : null
    }));
  }
};
