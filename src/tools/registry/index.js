/**
 * Tool Registry
 * 统一管理 workflow 可调用工具
 */

const { normalizeToolDefinition } = require('../../contracts/tool');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.aliases = new Map();
    this.registerListeners = new Set();
  }

  register(definition) {
    const tool = normalizeToolDefinition(definition);

    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Tool overwritten: ${tool.name}`);
    }

    this.tools.set(tool.name, tool);

    for (const alias of tool.aliases) {
      this.aliases.set(alias, tool.name);
    }

    for (const listener of this.registerListeners) {
      try {
        listener(tool);
      } catch (error) {
        console.error(`[ToolRegistry] Register listener failed for ${tool.name}:`, error.message);
      }
    }

    return tool;
  }

  onRegister(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('register listener must be a function');
    }

    this.registerListeners.add(listener);
    return () => this.registerListeners.delete(listener);
  }

  _resolveName(name) {
    const text = typeof name === 'string' ? name.trim() : '';
    if (!text) return '';
    return this.tools.has(text) ? text : (this.aliases.get(text) || text);
  }

  get(name) {
    const resolved = this._resolveName(name);
    return this.tools.get(resolved) || null;
  }

  has(name) {
    return Boolean(this.get(name));
  }

  list(options = {}) {
    const workflowVisibleOnly = options.workflowVisibleOnly === true;

    return Array.from(this.tools.values())
      .filter(tool => !workflowVisibleOnly || tool.metadata?.workflowVisible !== false)
      .map(tool => ({
      name: tool.name,
      description: tool.description,
      aliases: [...tool.aliases],
      permission: [...tool.permission],
      scopes: [...tool.scopes],
      readOnly: tool.readOnly,
      sideEffect: tool.sideEffect,
      riskLevel: tool.riskLevel,
      timeoutMs: tool.timeoutMs,
      origin: tool.origin,
      metadata: { ...tool.metadata }
      }));
  }

  matchMessage(message, options = {}) {
    const content = typeof message === 'string' ? message.trim().toLowerCase() : '';
    if (!content) return null;

    const excludeNames = new Set(
      Array.isArray(options.excludeNames)
        ? options.excludeNames.map(item => String(item || '').trim()).filter(Boolean)
        : []
    );
    const includeNames = new Set(
      Array.isArray(options.includeNames)
        ? options.includeNames.map(item => String(item || '').trim()).filter(Boolean)
        : []
    );
    let bestMatch = null;
    let bestScore = -1;

    for (const tool of this.tools.values()) {
      if (excludeNames.has(tool.name)) continue;
      if (includeNames.size > 0 && !includeNames.has(tool.name)) continue;
      if (tool.metadata?.directMatch === false && options.allowNonDirect !== true) continue;

      const directAliases = Array.isArray(tool.metadata?.directAliases) && tool.metadata.directAliases.length > 0
        ? tool.metadata.directAliases
        : [tool.name, ...tool.aliases];
      const aliases = directAliases;
      for (const alias of aliases) {
        const normalizedAlias = String(alias || '').trim().toLowerCase();
        if (!normalizedAlias) continue;
        const startsWith = content.startsWith(normalizedAlias);
        if (!startsWith) continue;

        const score = this._buildMatchScore(tool, normalizedAlias, startsWith);
        if (score > bestScore) {
          bestMatch = tool;
          bestScore = score;
        }
      }
    }

    return bestMatch;
  }

  _buildMatchScore(tool, alias, startsWith) {
    const aliasLength = alias.length;
    const originWeight = tool.origin === 'builtin'
      ? 2000
      : (tool.origin === 'legacy-skill' ? 1000 : 0);
    const prefixWeight = startsWith ? 10000 : 0;
    return prefixWeight + originWeight + aliasLength;
  }

  async execute(name, context = {}, input = {}) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`tool not found: ${name}`);
    }

    return tool.execute(context, input);
  }
}

module.exports = {
  ToolRegistry
};
