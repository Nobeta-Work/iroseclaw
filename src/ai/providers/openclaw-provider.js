/**
 * OpenClaw agent bridge
 * 兼容 OpenClaw CLI agent 路径的 transport 层。
 * 注意：这不是“纯模型 provider”，而是 agent runtime bridge。
 */

const fs = require('fs');
const path = require('path');
const { execFile, spawnSync } = require('child_process');
const { promisify } = require('util');
const { safeParse, extractJson } = require('../../utils/json-utils');
const { generateRequestId } = require('../../utils/json-utils');
const { BaseModelProvider } = require('./base-provider');

const execFileAsync = promisify(execFile);
const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*m/g;
const NODE_MODULE_ROOTS = [
  '/usr/lib/node_modules',
  '/usr/local/lib/node_modules',
  path.join(process.env.HOME || '/root', '.npm-global', 'lib', 'node_modules')
];

function uniquePaths(items = []) {
  return [...new Set(items.filter(Boolean).map(item => path.resolve(String(item))))];
}

function getPackageDirCandidates() {
  const envCandidates = [
    process.env.IROSE_OPENCLAW_HOME,
    process.env.OPENCLAW_HOME
  ]
    .filter(Boolean)
    .map(item => String(item).trim())
    .filter(Boolean);

  const dirs = [...envCandidates];

  for (const root of NODE_MODULE_ROOTS) {
    dirs.push(path.join(root, 'openclaw'));

    if (!fs.existsSync(root)) {
      continue;
    }

    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.openclaw-')) {
          dirs.push(path.join(root, entry.name));
        }
      }
    } catch {
      continue;
    }
  }

  return uniquePaths(dirs);
}

function getEntryCandidates(packageDir) {
  if (!packageDir) return [];
  return uniquePaths([
    path.join(packageDir, 'openclaw.mjs'),
    path.join(packageDir, 'dist', 'index.js')
  ]);
}

class OpenClawAgentBridge extends BaseModelProvider {
  constructor(options = {}) {
    super(options);
    this.config = {
      subagentLabel: options.subagentLabel || 'iirose',
      timeout: options.timeout || 30000,
      local: options.local !== false,
      stateless: options.stateless !== false
    };
    this.logger = options.logger || console;
    this.execFileAsync = typeof options.execFileAsync === 'function'
      ? options.execFileAsync
      : execFileAsync;
    this.spawnSync = typeof options.spawnSync === 'function'
      ? options.spawnSync
      : spawnSync;
    this.openclawInvocation = null;
    this.openclawInvocationLogged = false;
    this.supportsStatefulSessions = true;
  }

  _buildExecutableInvocation(command, argsPrefix = [], label = '') {
    return {
      command,
      argsPrefix: Array.isArray(argsPrefix) ? [...argsPrefix] : [],
      label: label || [command, ...argsPrefix].join(' ')
    };
  }

  _resolveInvocationFromBinary(commandPath) {
    const target = typeof commandPath === 'string' ? commandPath.trim() : '';
    if (!target) return null;

    if (!fs.existsSync(target)) {
      return null;
    }

    if (/\.(?:mjs|js|cjs)$/i.test(target)) {
      return this._buildExecutableInvocation(process.execPath, [target], `${process.execPath} ${target}`);
    }

    return this._buildExecutableInvocation(target, [], target);
  }

  _canExecuteOpenClawCli() {
    const result = this.spawnSync('openclaw', ['--version'], {
      encoding: 'utf8',
      timeout: 3000
    });

    if (result.error) {
      return false;
    }

    return result.status === 0 || result.status === 1;
  }

  _resolveOpenClawInvocation() {
    if (this.openclawInvocation) {
      return this.openclawInvocation;
    }

    const explicitBinary = this._resolveInvocationFromBinary(
      process.env.IROSE_OPENCLAW_BIN || process.env.OPENCLAW_BIN || ''
    );
    if (explicitBinary) {
      this.openclawInvocation = explicitBinary;
      return explicitBinary;
    }

    if (this._canExecuteOpenClawCli()) {
      this.openclawInvocation = this._buildExecutableInvocation('openclaw', [], 'openclaw');
      return this.openclawInvocation;
    }

    for (const packageDir of getPackageDirCandidates()) {
      for (const entryPath of getEntryCandidates(packageDir)) {
        if (fs.existsSync(entryPath)) {
          this.openclawInvocation = this._buildExecutableInvocation(
            process.execPath,
            [entryPath],
            `${process.execPath} ${entryPath}`
          );
          return this.openclawInvocation;
        }
      }
    }

    this.openclawInvocation = this._buildExecutableInvocation('openclaw', [], 'openclaw');
    return this.openclawInvocation;
  }

  resolveInvocation() {
    return this._resolveOpenClawInvocation();
  }

  _buildExecArgs(args = []) {
    const invocation = this._resolveOpenClawInvocation();

    if (!this.openclawInvocationLogged) {
      this.logger.info?.(`[OpenClawAgentBridge] Using OpenClaw invocation: ${invocation.label}`);
      this.openclawInvocationLogged = true;
    }

    return {
      command: invocation.command,
      args: [...invocation.argsPrefix, ...args],
      invocation
    };
  }

  buildExecArgs(args = []) {
    return this._buildExecArgs(args);
  }

  _sanitizeSessionId(value, fallback = 'irose-chat') {
    const text = typeof value === 'string' ? value : String(value ?? '');
    const normalized = text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120);
    return normalized || fallback;
  }

  _buildStatelessSessionId(base = '') {
    const prefix = this._sanitizeSessionId(base, 'irose-chat');
    return this._sanitizeSessionId(`${prefix}-${generateRequestId()}`, prefix);
  }

  _resolveRequestSessionId(input = {}) {
    const requested = typeof input.sessionId === 'string' ? input.sessionId : String(input.sessionId ?? '');
    const stateful = input.statefulSession === true;
    if (stateful || this.config.stateless === false) {
      return this._sanitizeSessionId(requested, 'irose-chat');
    }
    return this._buildStatelessSessionId(requested || input.agentLabel || this.config.subagentLabel);
  }

  _buildPromptText(input = {}) {
    if (typeof input.message === 'string' && input.message.trim()) {
      return input.message;
    }

    if (Array.isArray(input.messages) && input.messages.length > 0) {
      const parts = input.messages
        .map(item => {
          const role = typeof item?.role === 'string' ? item.role.trim() : 'user';
          const content = typeof item?.content === 'string' ? item.content.trim() : '';
          return content ? `[${role}] ${content}` : '';
        })
        .filter(Boolean);
      if (parts.length > 0) {
        return parts.join('\n\n');
      }
    }

    const promptParts = [
      typeof input.systemPrompt === 'string' ? input.systemPrompt.trim() : '',
      typeof input.userPrompt === 'string' ? input.userPrompt.trim() : ''
    ].filter(Boolean);

    return promptParts.join('\n\n');
  }

  buildAgentArgs(input = {}) {
    const timeoutMs = Number.isFinite(Number(input.timeoutMs))
      ? Number(input.timeoutMs)
      : this.config.timeout;
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const args = [
      'agent',
      '--agent',
      input.agentLabel || this.config.subagentLabel,
      '--message',
      typeof input.message === 'string' ? input.message : '',
      '--timeout',
      String(timeoutSeconds),
      '--session-id',
      this._resolveRequestSessionId(input)
    ];

    if ((input.local ?? this.config.local) !== false) {
      args.splice(1, 0, '--local');
    }

    if (input.json === true) {
      args.push('--json');
    }

    return args;
  }

  _extractJsonPayload(stdout) {
    if (typeof stdout !== 'string' || !stdout.trim()) {
      return null;
    }

    const direct = safeParse(stdout);
    if (direct) {
      return direct;
    }

    const objectStart = stdout.indexOf('{');
    const objectEnd = stdout.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      const objectPayload = safeParse(stdout.slice(objectStart, objectEnd + 1));
      if (objectPayload) {
        return objectPayload;
      }
    }

    return extractJson(stdout);
  }

  _extractTextFromJson(stdout) {
    if (typeof stdout !== 'string' || !stdout.trim()) {
      return '';
    }

    const payload = this._extractJsonPayload(stdout);
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    const candidates = [
      payload?.result?.payloads,
      payload?.payloads,
      payload?.result?.result?.payloads
    ];

    for (const items of candidates) {
      const reply = Array.isArray(items)
        ? items.find(item => typeof item?.text === 'string' && item.text.trim())
        : null;
      if (reply?.text) {
        return reply.text.trim();
      }
    }

    const textCandidates = [
      payload?.result?.text,
      payload?.text,
      payload?.result?.result?.text
    ];

    for (const text of textCandidates) {
      if (typeof text === 'string' && text.trim()) {
        return text.trim();
      }
    }

    return '';
  }

  extractTextFromJson(stdout) {
    return this._extractTextFromJson(stdout);
  }

  _extractTextFromPlain(stdout) {
    if (typeof stdout !== 'string' || !stdout.trim()) {
      return '';
    }

    const lines = stdout
      .split(/\r?\n/)
      .map(line => String(line ?? '').trim())
      .filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const normalized = line.replace(ANSI_ESCAPE_REGEX, '').trim();
      if (
        normalized.startsWith('Config warnings:') ||
        normalized.startsWith('- plugins.entries.') ||
        normalized.startsWith('Gateway agent failed;') ||
        normalized.startsWith('[plugins]') ||
        normalized.startsWith('[diagnostic]') ||
        normalized.startsWith('[agent/embedded]') ||
        /^[\[\]{}",]+$/.test(normalized)
      ) {
        continue;
      }
      return normalized;
    }

    return '';
  }

  extractTextFromPlain(stdout) {
    return this._extractTextFromPlain(stdout);
  }

  _formatErrorReason(error) {
    if (!error) {
      return 'unknown error';
    }

    const stderrText = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const stdoutText = typeof error.stdout === 'string' ? error.stdout.trim() : '';
    const jsonText = this._extractTextFromJson(stdoutText);
    const plainText = this._extractTextFromPlain(stdoutText);
    const message = jsonText
      || plainText
      || stderrText
      || stdoutText
      || error.message
      || 'unknown error';
    return message.slice(0, 1000);
  }

  formatErrorReason(error) {
    return this._formatErrorReason(error);
  }

  async complete(input = {}) {
    const message = this._buildPromptText(input);
    const timeoutMs = Number.isFinite(Number(input.timeoutMs))
      ? Number(input.timeoutMs)
      : this.config.timeout;
    const args = this.buildAgentArgs({
      agentLabel: input.agentLabel || this.config.subagentLabel,
      message,
      timeoutMs,
      sessionId: input.sessionId || '',
      statefulSession: input.statefulSession === true,
      local: input.local,
      json: input.json === true
    });
    const execution = this._buildExecArgs(args);
    const execTimeout = timeoutMs + 15000;

    try {
      const result = await this.execFileAsync(execution.command, execution.args, {
        timeout: execTimeout,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });
      const stdout = typeof result?.stdout === 'string' ? result.stdout : '';
      const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
      const jsonText = this._extractTextFromJson(stdout);
      const plainText = this._extractTextFromPlain(stdout);

      return {
        ok: true,
        provider: 'openclaw',
        text: jsonText || plainText,
        jsonText,
        plainText,
        json: this._extractJsonPayload(stdout),
        stdout,
        stderr,
        raw: {
          stdout,
          stderr,
          command: execution.command,
          args: execution.args
        },
        error: ''
      };
    } catch (error) {
      const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
      const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
      const jsonText = this._extractTextFromJson(stdout);
      const plainText = this._extractTextFromPlain(stdout);

      return {
        ok: false,
        provider: 'openclaw',
        text: jsonText || plainText,
        jsonText,
        plainText,
        json: this._extractJsonPayload(stdout),
        stdout,
        stderr,
        raw: {
          stdout,
          stderr,
          command: execution.command,
          args: execution.args
        },
        error: this._formatErrorReason(error)
      };
    }
  }
}

const OpenClawProvider = OpenClawAgentBridge;

module.exports = {
  OpenClawAgentBridge,
  OpenClawProvider
};
