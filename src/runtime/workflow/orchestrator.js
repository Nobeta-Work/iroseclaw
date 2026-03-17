/**
 * Workflow Orchestrator (compatibility wrapper)
 * 仅保留给旧代码路径，新的 runtime 应优先依赖 planner。
 */

const { LegacyOpenClawPlanner } = require('./planners/legacy-openclaw-planner');

class OpenClawWorkflowOrchestrator extends LegacyOpenClawPlanner {}

module.exports = {
  OpenClawWorkflowOrchestrator
};
