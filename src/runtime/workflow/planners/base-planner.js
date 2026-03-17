/**
 * Base workflow planner
 * 统一 workflow 下一步决策接口。
 */

class BaseWorkflowPlanner {
  constructor(options = {}) {
    this.options = { ...options };
  }

  async decideNextStep() {
    throw new Error('BaseWorkflowPlanner.decideNextStep() must be implemented by subclasses.');
  }
}

module.exports = {
  BaseWorkflowPlanner
};
