/**
 * Persona memory store
 * 负责长期人格记忆快照的磁盘持久化。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normalizeText(value, max = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function resolvePromptKey(input = '') {
  return normalizeText(input, 160).replace(/\.md$/i, '');
}

function cloneValue(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

class PersonaMemoryStore {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.persist = options.persist !== false;
    this.dataDir = path.resolve(
      typeof options.dataDir === 'string' && options.dataDir.trim()
        ? options.dataDir.trim()
        : path.join(process.cwd(), 'data', 'runtime', 'prompt-memory')
    );

    if (this.enabled && this.persist) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  getFilePath(promptKey = '') {
    const normalizedKey = resolvePromptKey(promptKey);
    if (!normalizedKey) return '';
    const hash = crypto.createHash('sha1').update(normalizedKey).digest('hex');
    return path.join(this.dataDir, `${hash}.json`);
  }

  read(promptKey = '') {
    if (!this.enabled || !this.persist) return null;

    const filePath = this.getFilePath(promptKey);
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  write(promptKey = '', state = {}) {
    if (!this.enabled || !this.persist) return null;

    const filePath = this.getFilePath(promptKey);
    if (!filePath) return null;

    const snapshot = {
      promptKey: resolvePromptKey(promptKey),
      promptPath: normalizeText(state.promptPath, 500),
      promptLabel: normalizeText(state.promptLabel, 160),
      entries: Array.isArray(state.entries) ? cloneValue(state.entries) : [],
      pendingRounds: Array.isArray(state.pendingRounds) ? cloneValue(state.pendingRounds) : [],
      updatedAt: normalizeText(state.updatedAt, 80) || new Date().toISOString()
    };

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return snapshot;
  }

  remove(promptKey = '') {
    const filePath = this.getFilePath(promptKey);
    if (!filePath || !fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);
    return true;
  }
}

module.exports = {
  PersonaMemoryStore,
  resolvePromptKey
};
