/**
 * Runtime plugin host
 * 统一承载 tool/output/policy/trigger-template/service 扩展注册
 */

const { sendReplyThroughRuntime } = require('../message/handler');
const { normalizeToolPackage } = require('../../tools/packages');
const { WorkflowHookRegistry } = require('../workflow/hooks/registry');

class PluginHost {
  constructor(options = {}) {
    this.config = options.config || {};
    this.logger = options.logger || console;
    this.ctx = options.ctx || null;
    this.skillManager = options.skillManager || null;
    this.toolRegistry = options.toolRegistry || null;
    this.outputRuntime = options.outputRuntime || null;
    this.policyEngine = options.policyEngine || null;
    this.triggerTemplateRegistry = options.triggerTemplateRegistry || null;
    this.contextService = options.contextService || null;
    this.workflowRuntime = options.workflowRuntime || null;
    this.pickFallback = typeof options.pickFallback === 'function' ? options.pickFallback : null;
    this.stateStore = options.stateStore || null;
    this.services = new Map();
    this.plugins = new Map();
    this.providers = new Map();
    this.planners = new Map();
    this.hookRegistry = options.hookRegistry || new WorkflowHookRegistry({
      logger: this.logger
    });
    this.toolPackages = new Map();
    this.cleanups = new Map();
  }

  registerService(name, service) {
    const key = String(name || '').trim();
    if (!key) {
      throw new Error('service name is required');
    }
    this.services.set(key, service);
    return service;
  }

  getService(name) {
    return this.services.get(String(name || '').trim()) || null;
  }

  registerTool(definition) {
    if (!this.toolRegistry) {
      throw new Error('tool registry is not configured');
    }
    return this.toolRegistry.register(definition);
  }

  registerToolPackage(definition, options = {}) {
    const toolPackage = normalizeToolPackage(definition);
    const packageName = toolPackage.name;
    const pluginName = typeof options.pluginName === 'string' ? options.pluginName.trim() : '';

    if (this.toolPackages.has(packageName)) {
      this.logger.warn?.(`[PluginHost] Tool package overwritten: ${packageName}`);
    }

    const registeredTools = toolPackage.tools.map(tool => this.registerTool(tool));
    const outputPluginCleanups = toolPackage.outputPlugins
      .map(plugin => this.registerOutputPlugin(plugin))
      .filter(cleanup => typeof cleanup === 'function');
    const registeredTriggerTemplates = toolPackage.triggerTemplates
      .map(entry => ({
        kind: entry.kind,
        template: this.registerTriggerTemplate(entry.kind, entry.template)
      }));
    const registeredPolicies = toolPackage.policies.map(rule => this.registerPolicyRule(rule));
    const registeredHooks = toolPackage.hooks.map(hook => this.registerHook(hook));

    if (pluginName) {
      for (const cleanup of outputPluginCleanups) {
        this.registerCleanup(pluginName, cleanup);
      }
      for (const cleanup of registeredPolicies) {
        if (typeof cleanup === 'function') {
          this.registerCleanup(pluginName, cleanup);
        }
      }
    }

    const registration = {
      ...toolPackage,
      tools: registeredTools,
      outputPlugins: [...toolPackage.outputPlugins],
      triggerTemplates: registeredTriggerTemplates,
      hooks: registeredHooks,
      policies: registeredPolicies
    };
    this.toolPackages.set(packageName, registration);
    return registration;
  }

  listToolPackages() {
    return Array.from(this.toolPackages.values()).map(item => ({
      name: item.name,
      version: item.version,
      tools: item.tools.map(tool => tool.name),
      triggerTemplates: item.triggerTemplates.map(entry => entry.kind),
      hooks: item.hooks.length,
      outputPlugins: item.outputPlugins.length,
      policies: item.policies.length,
      metadata: { ...item.metadata }
    }));
  }

  registerProvider(name, provider) {
    const key = String(name || '').trim();
    if (!key) {
      throw new Error('provider name is required');
    }
    if (typeof provider !== 'function' && (!provider || typeof provider.complete !== 'function')) {
      throw new TypeError('provider must implement complete() or be a factory function');
    }
    this.providers.set(key, provider);
    return provider;
  }

  getProvider(name) {
    return this.providers.get(String(name || '').trim()) || null;
  }

  listProviders() {
    return Array.from(this.providers.keys());
  }

  registerPlanner(name, planner) {
    const key = String(name || '').trim();
    if (!key) {
      throw new Error('planner name is required');
    }
    if (typeof planner !== 'function' && (!planner || typeof planner.decideNextStep !== 'function')) {
      throw new TypeError('planner must implement decideNextStep() or be a factory function');
    }
    this.planners.set(key, planner);
    return planner;
  }

  getPlanner(name) {
    return this.planners.get(String(name || '').trim()) || null;
  }

  listPlanners() {
    return Array.from(this.planners.keys());
  }

  registerOutputPlugin(plugin) {
    if (!this.outputRuntime) {
      throw new Error('output runtime is not configured');
    }
    return this.outputRuntime.registerPlugin(plugin);
  }

  registerHook(hook) {
    return this.hookRegistry.register(hook);
  }

  listHooks() {
    return this.hookRegistry.list();
  }

  registerPolicyRule(rule) {
    if (!this.policyEngine) {
      throw new Error('policy engine is not configured');
    }
    return this.policyEngine.registerRule(rule);
  }

  registerTriggerTemplate(kind, template) {
    if (!this.triggerTemplateRegistry) {
      throw new Error('trigger template registry is not configured');
    }
    return this.triggerTemplateRegistry.register(kind, template);
  }

  registerPlugin(plugin) {
    if (!plugin || typeof plugin !== 'object') {
      throw new TypeError('plugin must be an object');
    }

    const name = String(plugin.name || '').trim();
    if (!name) {
      throw new Error('plugin requires a name');
    }

    if (this.plugins.has(name)) {
      this.logger.warn?.(`[PluginHost] Plugin overwritten: ${name}`);
    }

    if (typeof plugin.apply !== 'function') {
      throw new Error(`plugin "${name}" requires apply()`);
    }

    this.plugins.set(name, plugin);
    this.cleanups.set(name, []);
    plugin.apply(this, this._buildPluginContext(name));
    return plugin;
  }

  listPlugins() {
    return Array.from(this.plugins.keys());
  }

  setContextService(contextService) {
    this.contextService = contextService || null;
  }

  setWorkflowRuntime(workflowRuntime) {
    this.workflowRuntime = workflowRuntime || null;
  }

  setKoishiContext(ctx) {
    this.ctx = ctx || null;
  }

  setFallbackPicker(pickFallback) {
    this.pickFallback = typeof pickFallback === 'function' ? pickFallback : null;
  }

  getPluginConfig(pluginName, fallback = {}) {
    const normalizedName = String(pluginName || '').trim();
    if (!normalizedName) {
      return { ...fallback };
    }

    const pluginConfig =
      this.config.pluginConfigs?.[normalizedName]
      || this.config.plugins?.[normalizedName]
      || null;

    if (!pluginConfig || typeof pluginConfig !== 'object' || Array.isArray(pluginConfig)) {
      return { ...fallback };
    }

    return {
      ...fallback,
      ...pluginConfig
    };
  }

  registerCleanup(pluginName, cleanup) {
    const normalizedName = String(pluginName || '').trim();
    if (!normalizedName) {
      throw new Error('plugin name is required for cleanup registration');
    }
    if (typeof cleanup !== 'function') {
      throw new TypeError('cleanup must be a function');
    }

    const bucket = this.cleanups.get(normalizedName) || [];
    bucket.push(cleanup);
    this.cleanups.set(normalizedName, bucket);
    return cleanup;
  }

  async runWorkflow(input = {}) {
    if (!this.workflowRuntime || typeof this.workflowRuntime.run !== 'function') {
      throw new Error('workflow runtime is not configured');
    }

    return this.workflowRuntime.run(input);
  }

  async dispatchTrigger(trigger, options = {}) {
    if (!this.workflowRuntime || typeof this.workflowRuntime.run !== 'function') {
      throw new Error('workflow runtime is not configured');
    }

    const kind = String(trigger?.kind || '').trim();
    const availableTools = Array.isArray(options.availableTools)
      ? options.availableTools
      : (this.triggerTemplateRegistry
        ? this.triggerTemplateRegistry.resolveTools(this.toolRegistry, kind)
        : this.toolRegistry?.list({ workflowVisibleOnly: true }) || []);

    const context = options.context && typeof options.context === 'object'
      ? { ...options.context }
      : {};
    if (!context.ctx && this.ctx) {
      context.ctx = this.ctx;
    }

    const workflowResult = await this.workflowRuntime.run({
      trigger,
      protocolRequest: options.protocolRequest || {},
      context,
      availableTools
    });

    const workflowDecision = workflowResult?.decision;
    const hasFinalOutput = Boolean(workflowResult?.outputResult);
    const hasToolOutput = Array.isArray(workflowResult?.outputResults) && workflowResult.outputResults.length > 0;

    if (
      (workflowDecision?.status === 'error' || workflowDecision?.status === 'blocked') &&
      options.sendFallbackOnError === true &&
      this.outputRuntime &&
      this.pickFallback &&
      context.session
    ) {
      await sendReplyThroughRuntime(this.outputRuntime, context, this.pickFallback());
    }

    if (
      !hasFinalOutput &&
      !hasToolOutput &&
      options.sendFallbackOnError === true &&
      this.outputRuntime &&
      this.pickFallback &&
      context.session
    ) {
      await sendReplyThroughRuntime(this.outputRuntime, context, this.pickFallback());
    }

    return workflowResult;
  }

  dispose() {
    for (const pluginName of this.plugins.keys()) {
      const cleanups = this.cleanups.get(pluginName) || [];
      while (cleanups.length > 0) {
        const cleanup = cleanups.pop();
        try {
          cleanup();
        } catch (error) {
          this.logger.error?.(`[PluginHost] Cleanup failed for ${pluginName}: ${error.message}`);
        }
      }
    }
    this.cleanups.clear();
  }

  _buildPluginContext(pluginName) {
    return {
      pluginName,
      config: this.config,
      pluginConfig: this.getPluginConfig(pluginName),
      logger: this.logger,
      ctx: this.ctx,
      skillManager: this.skillManager,
      toolRegistry: this.toolRegistry,
      outputRuntime: this.outputRuntime,
      policyEngine: this.policyEngine,
      triggerTemplateRegistry: this.triggerTemplateRegistry,
      contextService: this.contextService,
      workflowRuntime: this.workflowRuntime,
      stateStore: this.stateStore,
      hookRegistry: this.hookRegistry,
      pickFallback: this.pickFallback,
      getPluginConfig: (fallback = {}) => this.getPluginConfig(pluginName, fallback),
      registerTool: (definition) => this.registerTool(definition),
      registerToolPackage: (definition) => this.registerToolPackage(definition, { pluginName }),
      registerOutputPlugin: (plugin) => this.registerOutputPlugin(plugin),
      registerPolicyRule: (rule) => this.registerPolicyRule(rule),
      registerTriggerTemplate: (kind, template) => this.registerTriggerTemplate(kind, template),
      registerProvider: (name, provider) => this.registerProvider(name, provider),
      registerPlanner: (name, planner) => this.registerPlanner(name, planner),
      registerHook: (hook) => this.registerHook(hook),
      registerCleanup: (cleanup) => this.registerCleanup(pluginName, cleanup),
      dispatchTrigger: (trigger, options = {}) => this.dispatchTrigger(trigger, options),
      runWorkflow: (input = {}) => this.runWorkflow(input),
      host: this
    };
  }
}

module.exports = {
  PluginHost
};
