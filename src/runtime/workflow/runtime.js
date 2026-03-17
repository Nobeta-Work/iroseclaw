/**
 * Workflow Runtime
 * 最小化 step loop 骨架，供后续替换 legacy 链路
 */

const { createTriggerEnvelope } = require('../../contracts/trigger');
const { createWorkflowEnvelope, normalizeWorkflowStepDecision } = require('../../contracts/workflow');
const { createToolResult } = require('../../contracts/tool');

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => cloneValue(item));
  }

  if (isPlainObject(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = cloneValue(item);
    }
    return result;
  }

  return value;
}

function mergeObjects(base = {}, patch = {}) {
  const result = isPlainObject(base) ? cloneValue(base) : {};
  if (!isPlainObject(patch)) {
    return result;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeObjects(result[key], value);
    } else {
      result[key] = cloneValue(value);
    }
  }

  return result;
}

class WorkflowRuntime {
  constructor(options = {}) {
    this.planner = options.planner || options.orchestrator || null;
    this.orchestrator = options.orchestrator || this.planner || null;
    this.toolRegistry = options.toolRegistry || null;
    this.outputRuntime = options.outputRuntime || null;
    this.policyEngine = options.policyEngine || null;
    this.stateStore = options.stateStore || null;
    this.hookRegistry = options.hookRegistry || null;
    this.logger = options.logger || console;
    this.runLogger = options.runLogger || null;
    this.maxSteps = Number.isFinite(Number(options.maxSteps))
      ? Math.max(1, Math.floor(Number(options.maxSteps)))
      : 6;
    this.maxToolCallsPerStep = Number.isFinite(Number(options.maxToolCallsPerStep))
      ? Math.max(1, Math.floor(Number(options.maxToolCallsPerStep)))
      : 4;
    this.allowParallelReadTools = options.allowParallelReadTools !== false;
  }

  async run(input = {}) {
    const trigger = createTriggerEnvelope(input.trigger || input);
    const startedAt = Date.now();
    const workflow = createWorkflowEnvelope({
      trigger,
      requestId: input.requestId,
      state: input.state
    });
    const context = input.context && typeof input.context === 'object' ? { ...input.context } : {};
    if (!context.workflowBudget) {
      context.workflowBudget = {
        messagesSent: 0,
        maxMessages: Number.isFinite(Number(this.policyEngine?.config?.maxMessagesPerWorkflow))
          ? Math.max(1, Math.floor(Number(this.policyEngine.config.maxMessagesPerWorkflow)))
          : 3
      };
    }
    let protocolRequest = input.protocolRequest || {};
    const planner = this._resolvePlanner();
    const emittedOutputResults = [];
    const stateKeys = this._resolveStateKeys(trigger, protocolRequest, context, workflow);
    const runtimeState = await this._loadStateSnapshot(stateKeys, workflow, input.state);
    workflow.state = { ...runtimeState.workflow };

    if (!planner) {
      const decision = normalizeWorkflowStepDecision({
        status: 'error',
        audit: {
          reason: 'workflow planner is not configured',
          blocked: false
        }
      });
      workflow.decisionHistory.push(decision);
      this._recordRun({
        workflow,
        status: decision.status,
        startedAt,
        finishedAt: Date.now()
      });
      await this._persistStateSnapshot(runtimeState, stateKeys);
      await this._runHooks('onWorkflowFinish', {
        workflow,
        decision,
        trigger,
        context,
        state: runtimeState
      });
      return {
        workflow,
        decision
      };
    }

    for (let stepIndex = 0; stepIndex < this.maxSteps; stepIndex++) {
      workflow.step = stepIndex;
      await this._runHooks('beforePlan', {
        workflow,
        trigger,
        context,
        protocolRequest,
        availableTools: Array.isArray(input.availableTools) ? input.availableTools : [],
        state: runtimeState
      });

      const decision = normalizeWorkflowStepDecision(
        await planner.decideNextStep({
          workflow,
          trigger,
          context,
          protocolRequest,
          availableTools: Array.isArray(input.availableTools) ? input.availableTools : [],
          state: runtimeState
        })
      );

      workflow.decisionHistory.push(decision);
      await this._runHooks('afterPlan', {
        workflow,
        trigger,
        context,
        protocolRequest,
        availableTools: Array.isArray(input.availableTools) ? input.availableTools : [],
        decision,
        state: runtimeState
      });
      this._applyStatePatch(runtimeState, decision.statePatch);
      workflow.state = { ...runtimeState.workflow };

      if (decision.status === 'final') {
        const finalOutputResults = await this._handleFinalOutput(decision.finalOutput, context, {
          workflow,
          trigger,
          state: runtimeState
        });
        if (finalOutputResults.length > 0) {
          workflow.outputHistory.push(...finalOutputResults);
        }
        const outputResult = finalOutputResults[0] || null;

        this._recordRun({
          workflow,
          status: decision.status,
          startedAt,
          finishedAt: Date.now()
        });
        await this._persistStateSnapshot(runtimeState, stateKeys);

        const result = {
          workflow,
          decision,
          outputResult,
          finalOutputResults,
          outputResults: [...emittedOutputResults]
        };
        await this._runHooks('onWorkflowFinish', {
          workflow,
          decision,
          trigger,
          context,
          state: runtimeState,
          result
        });
        return result;
      }

      if (decision.status === 'blocked' || decision.status === 'error') {
        this._recordRun({
          workflow,
          status: decision.status,
          startedAt,
          finishedAt: Date.now()
        });
        await this._persistStateSnapshot(runtimeState, stateKeys);
        const result = {
          workflow,
          decision,
          outputResults: [...emittedOutputResults]
        };
        await this._runHooks('onWorkflowFinish', {
          workflow,
          decision,
          trigger,
          context,
          state: runtimeState,
          result
        });
        return result;
      }

      if (decision.status === 'needs_tools') {
        if (!Array.isArray(decision.toolCalls) || decision.toolCalls.length === 0) {
          return {
            workflow,
            decision: normalizeWorkflowStepDecision({
              status: 'error',
              audit: {
                reason: 'workflow requested tools but toolCalls is empty',
                blocked: false
              }
            })
          };
        }

        const toolResults = await this.executeToolCalls(decision.toolCalls, context, {
          workflow,
          trigger,
          state: runtimeState
        });
        workflow.toolHistory.push(...toolResults);
        for (const toolResult of toolResults) {
          this._applyStatePatch(runtimeState, toolResult.statePatch);
        }
        workflow.state = { ...runtimeState.workflow };
        const outputResults = await this._handleToolResultsOutput(toolResults, context, {
          workflow,
          trigger,
          state: runtimeState
        });
        if (outputResults.length > 0) {
          workflow.outputHistory.push(...outputResults);
          emittedOutputResults.push(...outputResults);
        }
        continue;
      }
    }

    this._recordRun({
      workflow,
      status: 'error',
      startedAt,
      finishedAt: Date.now()
    });
    await this._persistStateSnapshot(runtimeState, stateKeys);
    const result = {
      workflow,
      decision: normalizeWorkflowStepDecision({
        status: 'error',
        audit: {
          reason: 'workflow exceeded max steps',
          blocked: false
        }
      }),
      outputResults: [...emittedOutputResults]
    };
    await this._runHooks('onWorkflowFinish', {
      workflow,
      decision: result.decision,
      trigger,
      context,
      state: runtimeState,
      result
    });
    return result;
  }

  async executeToolCalls(toolCalls = [], context = {}, runtimeContext = {}) {
    const calls = Array.isArray(toolCalls)
      ? toolCalls.slice(0, this.maxToolCallsPerStep)
      : [];
    const resolvedCalls = calls.map((toolCall) => ({
      toolCall,
      toolDefinition: this.toolRegistry?.get(toolCall.name) || null
    }));
    const results = [];
    const sequentialCalls = [];
    const parallelCalls = [];

    for (const entry of resolvedCalls) {
      const { toolCall, toolDefinition } = entry;
      const policyDecision = this.policyEngine
        ? await this.policyEngine.evaluateToolCall(context, toolCall, toolDefinition)
        : { allowed: true, action: 'allow', reason: '' };

      if (!policyDecision.allowed) {
        results.push(createToolResult({
          ok: false,
          name: toolCall.name,
          callId: toolCall.callId,
          error: policyDecision.reason
        }));
        continue;
      }

      if (!toolDefinition) {
        results.push(createToolResult({
          ok: false,
          name: toolCall.name,
          callId: toolCall.callId,
          error: 'tool not found'
        }));
        continue;
      }

      const executionEntry = { toolCall, toolDefinition };
      if (this.allowParallelReadTools && toolDefinition.readOnly === true && toolDefinition.sideEffect !== true) {
        parallelCalls.push(executionEntry);
      } else {
        sequentialCalls.push(executionEntry);
      }
    }

    if (parallelCalls.length > 0) {
      const parallelResults = await Promise.all(parallelCalls.map(entry => this._executeSingleToolCall(entry, context, runtimeContext)));
      results.push(...parallelResults);
    }

    for (const entry of sequentialCalls) {
      results.push(await this._executeSingleToolCall(entry, context, runtimeContext));
    }

    return results;
  }

  async _executeSingleToolCall(entry, context = {}, runtimeContext = {}) {
    const { toolCall, toolDefinition } = entry;

    try {
      await this._runHooks('beforeToolCall', {
        ...runtimeContext,
        context,
        toolCall,
        toolDefinition
      });
      const toolResult = await this.toolRegistry.execute(toolCall.name, context, toolCall.arguments);
      const rawResult = (toolResult && typeof toolResult === 'object' && !Array.isArray(toolResult))
        ? toolResult.result
        : toolResult;
      const normalized = createToolResult({
        ok: toolResult?.ok !== false,
        name: toolCall.name,
        callId: toolCall.callId,
        result: rawResult === undefined ? null : rawResult,
        data: toolResult?.data,
        outputs: toolResult?.outputs,
        statePatch: toolResult?.statePatch,
        summary: toolResult?.summary || (typeof rawResult === 'string' ? rawResult.slice(0, 120) : ''),
        error: toolResult?.error || ''
      });
      await this._runHooks('afterToolCall', {
        ...runtimeContext,
        context,
        toolCall,
        toolDefinition,
        toolResult: normalized
      });
      return normalized;
    } catch (error) {
      const normalized = createToolResult({
        ok: false,
        name: toolCall.name,
        callId: toolCall.callId,
        error: error.message
      });
      await this._runHooks('afterToolCall', {
        ...runtimeContext,
        context,
        toolCall,
        toolDefinition,
        toolResult: normalized
      });
      return normalized;
    }
  }

  async _handleFinalOutput(finalOutput = {}, context = {}, runtimeContext = {}) {
    if (!this.outputRuntime) {
      return [];
    }

    const operations = [];
    if (Array.isArray(finalOutput.operations) && finalOutput.operations.length > 0) {
      operations.push(...finalOutput.operations);
    }

    if (operations.length === 0 && finalOutput.mode === 'reply' && finalOutput.text) {
      operations.push({
        kind: 'reply.current',
        content: {
          text: finalOutput.text,
          useMemePipeline: true
        }
      });
    }

    if (operations.length === 0) {
      return [];
    }

    return this._executeOutputOperations(operations, context, runtimeContext);
  }

  async _handleToolResultsOutput(toolResults = [], context = {}, runtimeContext = {}) {
    if (!this.outputRuntime) {
      return [];
    }

    const operations = [];

    for (const toolResult of toolResults) {
      if (!toolResult || toolResult.ok === false) continue;
      if (Array.isArray(toolResult.outputs) && toolResult.outputs.length > 0) {
        operations.push(...toolResult.outputs);
        continue;
      }
      if (typeof toolResult.result !== 'string' || !toolResult.result.trim()) continue;

      operations.push({
        kind: 'reply.current',
        content: {
          text: toolResult.result,
          useMemePipeline: false
        }
      });
    }

    if (operations.length === 0) {
      return [];
    }

    return this._executeOutputOperations(operations, context, runtimeContext);
  }

  async handleToolResultsOutput(toolResults = [], context = {}) {
    return this._handleToolResultsOutput(toolResults, context);
  }

  _recordRun(input = {}) {
    if (!this.runLogger || typeof this.runLogger.recordRun !== 'function') {
      return;
    }

    const workflow = input.workflow || {};
    this.runLogger.recordRun({
      workflowId: workflow.workflowId,
      requestId: workflow.requestId,
      trigger: workflow.trigger,
      decisionHistory: workflow.decisionHistory,
      toolHistory: workflow.toolHistory,
      outputHistory: workflow.outputHistory,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt
    });
  }

  _resolvePlanner() {
    if (this.planner && typeof this.planner.decideNextStep === 'function') {
      return this.planner;
    }

    if (this.orchestrator && typeof this.orchestrator.decideNextStep === 'function') {
      return this.orchestrator;
    }

    return null;
  }

  async _executeOutputOperations(operations = [], context = {}, runtimeContext = {}) {
    if (!this.outputRuntime) {
      return [];
    }

    const results = [];

    for (const operation of Array.isArray(operations) ? operations : [operations]) {
      await this._runHooks('beforeOutput', {
        ...runtimeContext,
        context,
        operation
      });
      const operationResults = await this.outputRuntime.executeBatch([operation], context);
      for (const result of operationResults) {
        await this._runHooks('afterOutput', {
          ...runtimeContext,
          context,
          operation,
          outputResult: result
        });
      }
      results.push(...operationResults);
    }

    return results;
  }

  _resolveStateKeys(trigger = {}, protocolRequest = {}, context = {}, workflow = {}) {
    const protocolSession = protocolRequest?.session || {};
    const triggerSession = trigger?.session || {};
    const contextSession = context?.session || {};
    const roomId = protocolSession.channelId
      || protocolSession.chatId
      || triggerSession.channelId
      || triggerSession.chatId
      || contextSession.channelId
      || contextSession.chatId
      || '';
    const userId = protocolSession.userId
      || triggerSession.userId
      || context?.userId
      || contextSession.userId
      || '';
    const sessionKey = roomId || userId || workflow.workflowId;

    return {
      workflow: workflow.workflowId,
      session: sessionKey,
      room: roomId,
      user: userId
    };
  }

  async _loadStateSnapshot(stateKeys = {}, workflow = {}, inputState = {}) {
    const snapshot = {
      workflow: {},
      session: {},
      room: {},
      user: {}
    };

    if (this.stateStore && typeof this.stateStore.get === 'function') {
      for (const scope of Object.keys(snapshot)) {
        const key = stateKeys[scope];
        if (!key) continue;
        const value = await this.stateStore.get(scope, key);
        snapshot[scope] = isPlainObject(value) ? value : {};
      }
    }

    if (inputState && typeof inputState === 'object') {
      for (const scope of Object.keys(snapshot)) {
        if (isPlainObject(inputState[scope])) {
          snapshot[scope] = mergeObjects(snapshot[scope], inputState[scope]);
        }
      }
    }

    if (isPlainObject(workflow.state)) {
      snapshot.workflow = mergeObjects(snapshot.workflow, workflow.state);
    }

    return snapshot;
  }

  _applyStatePatch(snapshot = {}, patch = {}) {
    if (!patch || typeof patch !== 'object') {
      return snapshot;
    }

    for (const scope of ['workflow', 'session', 'room', 'user']) {
      if (!isPlainObject(patch[scope])) continue;
      snapshot[scope] = mergeObjects(snapshot[scope], patch[scope]);
    }

    return snapshot;
  }

  async _persistStateSnapshot(snapshot = {}, stateKeys = {}) {
    if (!this.stateStore || typeof this.stateStore.set !== 'function') {
      return;
    }

    for (const scope of ['workflow', 'session', 'room', 'user']) {
      const key = stateKeys[scope];
      if (!key) continue;
      await this.stateStore.set(scope, key, snapshot[scope] || {});
    }
  }

  async _runHooks(methodName, payload = {}) {
    if (!this.hookRegistry || typeof this.hookRegistry.run !== 'function') {
      return [];
    }

    return this.hookRegistry.run(methodName, payload);
  }
}

module.exports = {
  WorkflowRuntime
};
