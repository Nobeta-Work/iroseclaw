/**
 * Workflow run log
 * 记录 workflow 运行结果，作为后续 replay 基础
 */

const fs = require('fs');
const path = require('path');

class WorkflowRunLog {
  constructor(config = {}) {
    const dataDir = path.resolve(config.dataDir || path.join(process.cwd(), 'data', 'workflow-runs'));
    const fileName = typeof config.fileName === 'string' && config.fileName.trim()
      ? config.fileName.trim()
      : 'workflow-runs.jsonl';
    const maxBytes = toPositiveInt(config.maxBytes, 8 * 1024 * 1024);
    const targetBytesAfterCompact = Math.min(
      maxBytes,
      toPositiveInt(config.targetBytesAfterCompact, Math.floor(maxBytes * 0.75))
    );
    this.config = {
      enabled: config.enabled !== false,
      dataDir,
      fileName,
      filePath: path.resolve(dataDir, fileName),
      maxBytes,
      targetBytesAfterCompact,
      compactCheckInterval: toPositiveInt(config.compactCheckInterval, 20),
      persist: config.persist !== false
    };
    this.writeCount = 0;

    if (this.config.enabled && this.config.persist) {
      fs.mkdirSync(path.dirname(this.config.filePath), { recursive: true });
    }
  }

  recordRun(input = {}) {
    if (!this.config.enabled) return null;

    const entry = {
      workflowId: String(input.workflowId || '').trim(),
      requestId: String(input.requestId || '').trim(),
      trigger: input.trigger && typeof input.trigger === 'object' ? { ...input.trigger } : {},
      decisionHistory: Array.isArray(input.decisionHistory) ? [...input.decisionHistory] : [],
      toolHistory: Array.isArray(input.toolHistory) ? [...input.toolHistory] : [],
      outputHistory: Array.isArray(input.outputHistory) ? [...input.outputHistory] : [],
      status: String(input.status || '').trim() || 'unknown',
      startedAt: Number.isFinite(Number(input.startedAt)) ? Math.floor(Number(input.startedAt)) : Date.now(),
      finishedAt: Number.isFinite(Number(input.finishedAt)) ? Math.floor(Number(input.finishedAt)) : Date.now()
    };

    if (this.config.persist) {
      fs.appendFileSync(this.config.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
      this._compactIfNeeded();
    }

    return entry;
  }

  _compactIfNeeded() {
    this.writeCount += 1;
    if (this.writeCount % this.config.compactCheckInterval !== 0) {
      return;
    }

    let stat = null;
    try {
      stat = fs.statSync(this.config.filePath);
    } catch {
      return;
    }

    if (!stat || stat.size <= this.config.maxBytes) {
      return;
    }

    let content = '';
    try {
      content = fs.readFileSync(this.config.filePath, 'utf8');
    } catch {
      return;
    }

    const lines = content.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      return;
    }

    const retained = [];
    let bytes = 0;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
      if (retained.length > 0 && bytes + lineBytes > this.config.targetBytesAfterCompact) {
        break;
      }
      retained.push(line);
      bytes += lineBytes;
    }
    retained.reverse();

    const nextContent = retained.map(line => `${line}\n`).join('');
    const tempPath = `${this.config.filePath}.tmp`;
    try {
      fs.writeFileSync(tempPath, nextContent, 'utf8');
      fs.renameSync(tempPath, this.config.filePath);
    } catch {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // ignore cleanup failure
      }
    }
  }

  _getLogFilePath() {
    return this.config.filePath;
  }
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

module.exports = {
  WorkflowRunLog
};
