/**
 * In-memory state store
 */

const { StateStore } = require('./store');

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

class MemoryStateStore extends StateStore {
  constructor() {
    super();
    this.scopes = new Map();
  }

  _getScopeBucket(scope) {
    const scopeKey = String(scope || '').trim() || 'default';
    if (!this.scopes.has(scopeKey)) {
      this.scopes.set(scopeKey, new Map());
    }
    return this.scopes.get(scopeKey);
  }

  async get(scope, key) {
    const bucket = this._getScopeBucket(scope);
    const item = bucket.get(String(key || '').trim());
    return item === undefined ? null : cloneValue(item);
  }

  async set(scope, key, value) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      throw new Error('state key is required');
    }
    const bucket = this._getScopeBucket(scope);
    bucket.set(normalizedKey, cloneValue(value));
    return this.get(scope, normalizedKey);
  }

  async patch(scope, key, partial) {
    const current = await this.get(scope, key);
    const nextValue = mergeObjects(current || {}, partial || {});
    return this.set(scope, key, nextValue);
  }

  async delete(scope, key) {
    const bucket = this._getScopeBucket(scope);
    return bucket.delete(String(key || '').trim());
  }
}

module.exports = {
  MemoryStateStore
};
