/**
 * Persona memory service
 * 负责 prompt 级长期人格记忆的总结、压缩与 prompt 文件回写。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PersonaMemoryStore, resolvePromptKey: normalizePromptKey } = require('./store');

const MEMORY_BLOCK_OPEN = '<<<IIC_PERSONA_MEMORY';
const MEMORY_BLOCK_CLOSE = 'IIC_PERSONA_MEMORY>>>';

const SUMMARY_THRESHOLD_ROUNDS = 20;
const SUMMARY_THRESHOLD_AGE_MS = 60 * 60 * 1000;
const COMPRESSION_PICK_COUNT = 10;
const COMPRESSION_TARGET_COUNT = 5;
const DEFAULT_MAX_ENTRIES = 50;

function normalizeText(value, max = 1200) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeLineText(value, max = 1200) {
  return normalizeText(value, max).replace(/\r?\n+/g, ' ');
}

function normalizePositiveInt(value, fallback = 0, min = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.floor(num));
}

function normalizeImportance(value, fallback = 5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(10, Math.max(1, Math.floor(num)));
}

function normalizeIsoTime(value, fallback = new Date().toISOString()) {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (Number.isFinite(Number(value))) {
    const parsed = new Date(Number(value));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const parsedFallback = new Date(fallback);
  return Number.isNaN(parsedFallback.getTime())
    ? new Date().toISOString()
    : parsedFallback.toISOString();
}

function generateMemoryId(prefix = 'mem') {
  const entropy = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${Date.now()}_${entropy}`;
}

function normalizeCompressedFrom(value, fallback = []) {
  const source = Array.isArray(value) ? value : (typeof value === 'string' && value.trim() ? [value.trim()] : fallback);
  return Array.from(new Set(
    source
      .map(item => normalizeText(item, 160))
      .filter(Boolean)
  ));
}

function normalizeMemoryEntry(entry = {}, options = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const nowIso = normalizeIsoTime(options.now || Date.now());
  const createdAt = normalizeIsoTime(entry.createdAt || entry.time || options.createdAt || nowIso, nowIso);
  const time = normalizeIsoTime(entry.time || entry.createdAt || options.time || createdAt, createdAt);
  const sourceRoundCountFallback = normalizePositiveInt(options.defaultSourceRoundCount, 0, 0);
  const compressedFromFallback = Array.isArray(options.defaultCompressedFrom)
    ? options.defaultCompressedFrom
    : [];

  return {
    id: normalizeText(entry.id, 160) || generateMemoryId(),
    createdAt,
    time,
    timeRange: entry.timeRange && typeof entry.timeRange === 'object' && !Array.isArray(entry.timeRange)
      ? { ...entry.timeRange }
      : null,
    importance: normalizeImportance(entry.importance, normalizeImportance(options.defaultImportance, 5)),
    summary: normalizeLineText(entry.summary, 2000),
    sourceRoundCount: normalizePositiveInt(entry.sourceRoundCount, sourceRoundCountFallback, 0),
    compressedFrom: normalizeCompressedFrom(entry.compressedFrom, compressedFromFallback)
  };
}

function normalizeMemoryEntries(entries = [], options = {}) {
  const seen = new Map();
  for (const item of Array.isArray(entries) ? entries : []) {
    const normalized = normalizeMemoryEntry(item, options);
    if (!normalized || !normalized.id) continue;
    seen.set(normalized.id, normalized);
  }

  return Array.from(seen.values()).sort((left, right) => {
    const leftTime = new Date(left.createdAt || left.time || 0).getTime();
    const rightTime = new Date(right.createdAt || right.time || 0).getTime();
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
}

function escapeRegex(text = '') {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderPromptEntryLines(entry = {}) {
  const lines = [`- id: ${normalizeLineText(entry.id, 160)}`];
  const time = normalizeIsoTime(entry.time || entry.createdAt || Date.now());
  lines.push(`  time: ${time}`);
  lines.push(`  importance: ${normalizeImportance(entry.importance, 5)}`);
  lines.push(`  summary: ${normalizeLineText(entry.summary, 2000)}`);
  lines.push(`  sourceRoundCount: ${normalizePositiveInt(entry.sourceRoundCount, 0, 0)}`);
  lines.push(`  compressedFrom: ${JSON.stringify(normalizeCompressedFrom(entry.compressedFrom, []))}`);
  return lines;
}

function renderPromptBlock(label, entries = [], options = {}) {
  const blockLabel = typeof label === 'string' && label.trim() ? label.trim() : MEMORY_BLOCK_OPEN;
  const normalizedEntries = normalizeMemoryEntries(entries, options);
  if (normalizedEntries.length === 0) {
    return '';
  }

  const lines = [blockLabel];
  for (const entry of normalizedEntries) {
    lines.push(...renderPromptEntryLines(entry));
  }
  lines.push(MEMORY_BLOCK_CLOSE);
  return lines.join('\n');
}

function parsePromptEntryLines(lines = [], options = {}) {
  const entries = [];
  let current = null;

  function flushCurrent() {
    if (!current) return;
    const normalized = normalizeMemoryEntry(current, options);
    if (normalized) {
      entries.push(normalized);
    }
    current = null;
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trimEnd();
    if (!line.trim()) {
      continue;
    }

    const bulletMatch = line.match(/^\-\s*(?:([A-Za-z0-9_-]+)\s*:\s*)?(.*)$/);
    if (bulletMatch) {
      flushCurrent();
      current = {};
      if (bulletMatch[1]) {
        current.id = normalizeText(bulletMatch[2] || '', 160);
      }
      continue;
    }

    const fieldMatch = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!fieldMatch) {
      continue;
    }

    if (!current) {
      current = {};
    }

    const key = fieldMatch[1];
    const value = fieldMatch[2];
    switch (key) {
      case 'id':
        current.id = normalizeText(value, 160);
        break;
      case 'time':
      case 'createdAt':
        current.time = normalizeIsoTime(value);
        current.createdAt = normalizeIsoTime(value);
        break;
      case 'importance':
        current.importance = normalizeImportance(value, 5);
        break;
      case 'summary':
        current.summary = normalizeLineText(value, 2000);
        break;
      case 'sourceRoundCount':
        current.sourceRoundCount = normalizePositiveInt(value, 0, 0);
        break;
      case 'compressedFrom': {
        try {
          const parsed = JSON.parse(value);
          current.compressedFrom = normalizeCompressedFrom(parsed, []);
        } catch {
          current.compressedFrom = normalizeCompressedFrom(String(value || '').split(/[,\s]+/), []);
        }
        break;
      }
      default:
        current[key] = normalizeLineText(value, 2000);
        break;
    }
  }

  flushCurrent();
  return entries;
}

function parsePersonaMemoryBlock(content = '') {
  const text = typeof content === 'string' ? content : '';
  const regex = new RegExp(
    `${escapeRegex(MEMORY_BLOCK_OPEN)}\\s*\\r?\\n([\\s\\S]*?)\\r?\\n${escapeRegex(MEMORY_BLOCK_CLOSE)}`,
    'g'
  );

  let match = null;
  let lastBlock = null;
  let blockCount = 0;
  while ((match = regex.exec(text)) !== null) {
    blockCount += 1;
    lastBlock = {
      body: match[1] || '',
      start: match.index,
      end: regex.lastIndex
    };
  }

  if (!lastBlock) {
    return {
      hasBlock: false,
      blockCount: 0,
      memoryText: '',
      blockBody: '',
      entries: [],
      baseContent: text.trimEnd()
    };
  }

  const entries = parsePromptEntryLines(lastBlock.body.split(/\r?\n/));
  const stripped = text.replace(regex, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  return {
    hasBlock: true,
    blockCount,
    memoryText: `${MEMORY_BLOCK_OPEN}\n${lastBlock.body.trimEnd()}\n${MEMORY_BLOCK_CLOSE}`,
    blockBody: lastBlock.body.trimEnd(),
    entries,
    baseContent: stripped
  };
}

function serializePersonaMemoryBlock(entries = [], options = {}) {
  return renderPromptBlock(MEMORY_BLOCK_OPEN, entries, options);
}

function replacePersonaMemoryBlock(content = '', memoryBlockText = '') {
  const original = typeof content === 'string' ? content : '';
  const stripped = original
    .replace(new RegExp(`${escapeRegex(MEMORY_BLOCK_OPEN)}\\s*\\r?\\n[\\s\\S]*?\\r?\\n${escapeRegex(MEMORY_BLOCK_CLOSE)}\\s*`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  const block = typeof memoryBlockText === 'string' ? memoryBlockText.trim() : '';
  if (!block) {
    return stripped;
  }

  const lines = stripped ? stripped.split(/\r?\n/) : [];
  const headingIndex = lines.findIndex(line => /^##\s+长期记忆\s*$/.test(String(line || '').trim()));
  if (headingIndex < 0) {
    const prefix = stripped ? `${stripped}\n\n## 长期记忆\n\n` : '## 长期记忆\n\n';
    return `${prefix}${block}`.trimEnd();
  }

  let insertIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s+/.test(String(lines[index] || '').trim())) {
      insertIndex = index;
      break;
    }
  }

  const before = lines.slice(0, insertIndex);
  const after = lines.slice(insertIndex);
  if (before.length > 0 && before[before.length - 1].trim()) {
    before.push('');
  }
  before.push(block);
  if (after.length > 0 && after[0].trim()) {
    before.push('');
  }
  return [...before, ...after].join('\n').trimEnd();
}

function renderPromptRounds(label, rounds = []) {
  const sectionLabel = typeof label === 'string' && label.trim() ? label.trim() : 'IIC_PERSONA_PENDING_ROUNDS';
  const lines = [`<<<${sectionLabel}`];
  const normalizedRounds = Array.isArray(rounds) ? rounds : [];
  if (normalizedRounds.length === 0) {
    lines.push('(empty)');
  } else {
    for (const round of normalizedRounds) {
      lines.push(`- roundId: ${normalizeLineText(round.roundId, 160)}`);
      lines.push(`  timestamp: ${normalizeIsoTime(round.timestamp || round.createdAt || Date.now())}`);
      lines.push(`  sourceMode: ${normalizeLineText(round.sourceMode, 80)}`);
      lines.push(`  triggerKind: ${normalizeLineText(round.triggerKind, 80)}`);
      lines.push(`  sourceScope: ${normalizeLineText(round.sourceScope, 80)}`);
      lines.push(`  channelId: ${normalizeLineText(round.channelId, 160)}`);
      lines.push(`  userId: ${normalizeLineText(round.userId, 160)}`);
      lines.push(`  username: ${normalizeLineText(round.username, 160)}`);
      lines.push(`  currentMessage: ${normalizeLineText(round.currentMessage, 400)}`);
      lines.push(`  replyText: ${normalizeLineText(round.replyText, 400)}`);
    }
  }
  lines.push(`${sectionLabel}>>>`);
  return lines.join('\n');
}

function buildSummaryPrompt(input = {}) {
  const promptKey = normalizeText(input.promptKey, 160);
  const promptLabel = normalizeText(input.promptLabel, 160) || promptKey;
  const basePromptText = normalizeText(input.basePromptText, 12000);
  const existingEntries = normalizeMemoryEntries(input.entries || [], {});
  const pendingRounds = Array.isArray(input.pendingRounds) ? input.pendingRounds : [];
  const lines = [
    '你正在为 IIC 的某个常态 prompt 总结长期人格记忆。',
    '只输出 JSON，不要输出 markdown，不要输出解释。',
    `当前 promptKey: ${promptKey || 'unknown'}`,
    `当前 promptLabel: ${promptLabel || 'unknown'}`,
    '',
    '当前 prompt 原文如下：',
    '<<<IIC_PERSONA_PROMPT_BASE',
    basePromptText || '',
    'IIC_PERSONA_PROMPT_BASE>>>',
    '',
    '当前已存在的长期记忆如下：',
    serializePersonaMemoryBlock(existingEntries) || '<<<IIC_PERSONA_MEMORY\nIIC_PERSONA_MEMORY>>>',
    '',
    '待总结的 @bot 对话轮次如下：',
    renderPromptRounds('IIC_PERSONA_PENDING_ROUNDS', pendingRounds),
    '',
    '总结要求：',
    '- 优先提炼稳定偏好、关系判断、持续事项与人格相关信息',
    '- 不要复读原始聊天记录',
    '- 每条输出必须包含 id、time、importance、summary、sourceRoundCount、compressedFrom',
    '- 输出格式必须是 {"entries":[...]}'
  ];

  return lines.join('\n');
}

function buildCompressionPrompt(input = {}) {
  const promptKey = normalizeText(input.promptKey, 160);
  const promptLabel = normalizeText(input.promptLabel, 160) || promptKey;
  const basePromptText = normalizeText(input.basePromptText, 12000);
  const entries = normalizeMemoryEntries(input.entries || [], {});
  const selectedEntries = normalizeMemoryEntries(input.selectedEntries || [], {});
  const lines = [
    '你正在压缩某个 IIC 常态 prompt 的长期人格记忆。',
    '只输出 JSON，不要输出 markdown，不要输出解释。',
    `当前 promptKey: ${promptKey || 'unknown'}`,
    `当前 promptLabel: ${promptLabel || 'unknown'}`,
    '',
    '当前 prompt 原文如下：',
    '<<<IIC_PERSONA_PROMPT_BASE',
    basePromptText || '',
    'IIC_PERSONA_PROMPT_BASE>>>',
    '',
    '当前全部长期记忆如下：',
    serializePersonaMemoryBlock(entries) || '<<<IIC_PERSONA_MEMORY\nIIC_PERSONA_MEMORY>>>',
    '',
    `需要压缩的 ${selectedEntries.length || COMPRESSION_PICK_COUNT} 条最低重要度记忆如下：`,
    serializePersonaMemoryBlock(selectedEntries) || '<<<IIC_PERSONA_MEMORY\nIIC_PERSONA_MEMORY>>>',
    '',
    '压缩要求：',
    `- 将这批记忆压缩为 ${COMPRESSION_TARGET_COUNT} 条以内`,
    '- 保留时间、重要度、summary、sourceRoundCount、compressedFrom',
    '- 输出格式必须是 {"entries":[...]}'
  ];

  return lines.join('\n');
}

function parseJsonLikeText(raw = '') {
  const text = normalizeText(raw, 120000);
  if (!text) {
    return null;
  }

  const candidates = [];
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    candidates.push(fencedMatch[1].trim());
  }
  candidates.push(text);

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    if (typeof parsed === 'string' && parsed.trim()) {
      candidates.unshift(parsed.trim());
    }
  } catch {
    // ignore and continue to heuristics
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const candidate = text.slice(objectStart, objectEnd + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const candidate = text.slice(arrayStart, arrayEnd + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function getProviderText(result = {}) {
  if (result && typeof result.json === 'object' && result.json) {
    return result.json;
  }

  const candidates = [
    result?.jsonText,
    result?.text,
    result?.plainText
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function parseProviderEntries(result = {}) {
  const raw = getProviderText(result);
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    return entries;
  }

  const parsed = parseJsonLikeText(String(raw));
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (Array.isArray(parsed.entries)) {
    return parsed.entries;
  }

  return [];
}

function cloneState(state = {}) {
  return {
    promptKey: state.promptKey || '',
    promptPath: state.promptPath || '',
    promptLabel: state.promptLabel || '',
    basePromptText: state.basePromptText || '',
    memoryText: state.memoryText || '',
    entries: Array.isArray(state.entries) ? state.entries.map(entry => ({ ...entry })) : [],
    pendingRounds: Array.isArray(state.pendingRounds) ? state.pendingRounds.map(round => ({ ...round })) : [],
    updatedAt: state.updatedAt || new Date().toISOString()
  };
}

function createPersonaMemoryService(config = {}, logger = console) {
  const store = config.store instanceof PersonaMemoryStore
    ? config.store
    : new PersonaMemoryStore({
        enabled: config.enabled !== false,
        persist: config.persist !== false,
        dataDir: config.dataDir
      });

  let provider = config.provider || null;
  let promptProfileService = config.promptProfileService || null;
  const queues = new Map();
  const maxEntries = Math.max(1, normalizePositiveInt(config.maxEntries, DEFAULT_MAX_ENTRIES, 1));
  const summaryThresholdRounds = Math.max(1, normalizePositiveInt(config.summaryThresholdRounds, SUMMARY_THRESHOLD_ROUNDS, 1));
  const summaryThresholdAgeMs = Math.max(1, normalizePositiveInt(config.summaryThresholdAgeMs, SUMMARY_THRESHOLD_AGE_MS, 1));
  const compressionPickCount = Math.max(1, normalizePositiveInt(config.compressionPickCount, COMPRESSION_PICK_COUNT, 1));
  const compressionTargetCount = Math.max(1, normalizePositiveInt(config.compressionTargetCount, COMPRESSION_TARGET_COUNT, 1));
  const timeoutMs = Math.max(0, normalizePositiveInt(config.timeoutMs, 30000, 0));

  function now() {
    return typeof config.now === 'function' ? config.now() : Date.now();
  }

  function enqueue(promptKey, task) {
    const normalizedKey = normalizePromptKey(promptKey);
    if (!normalizedKey) {
      return Promise.resolve({
        ok: false,
        changed: false,
        recorded: false,
        reason: 'missing prompt key'
      });
    }

    const previous = queues.get(normalizedKey) || Promise.resolve();
    const next = previous
      .catch(() => null)
      .then(() => task())
      .catch((error) => {
        logger.warn?.(`[workflow.persona-memory] task failed for ${normalizedKey}: ${error.message}`);
        return {
          ok: false,
          changed: false,
          reason: error.message
        };
      })
      .finally(() => {
        if (queues.get(normalizedKey) === next) {
          queues.delete(normalizedKey);
        }
      });

    queues.set(normalizedKey, next);
    return next;
  }

  function resolvePromptProfileSnapshot(input = {}) {
    const direct = input.promptProfileSnapshot;
    if (direct && typeof direct === 'object') {
      return direct;
    }

    const service = input.promptProfileService || promptProfileService;
    if (service && typeof service.resolveProfile === 'function') {
      try {
        return service.resolveProfile() || null;
      } catch (error) {
        logger.warn?.(`[workflow.persona-memory] failed to resolve prompt profile: ${error.message}`);
      }
    }

    return null;
  }

  function resolvePromptKey(input = {}) {
    const snapshot = resolvePromptProfileSnapshot(input);
    const directKey = normalizePromptKey(input.promptKey || input.activePrompt || input.prompt || '');
    if (directKey) {
      return {
        promptKey: directKey,
        promptLabel: normalizeText(input.promptLabel, 160) || normalizeText(snapshot?.styleLabel || snapshot?.activePromptFile?.label, 160) || directKey,
        promptPath: resolvePromptPath(snapshot, directKey, input)
      };
    }

    const snapshotKey = normalizePromptKey(snapshot?.activePrompt || snapshot?.activePromptFile?.key || '');
    if (!snapshotKey) {
      return {
        promptKey: '',
        promptLabel: '',
        promptPath: ''
      };
    }

    return {
      promptKey: snapshotKey,
      promptLabel: normalizeText(snapshot?.styleLabel || snapshot?.activePromptFile?.label, 160) || snapshotKey,
      promptPath: resolvePromptPath(snapshot, snapshotKey, input)
    };
  }

  function resolvePromptPath(snapshot, promptKey, input = {}) {
    const activePath = normalizeText(snapshot?.activePromptFile?.path, 500);
    if (activePath) {
      return path.resolve(activePath);
    }

    const promptDir = normalizeText(
      input.promptDir || snapshot?.promptDir || config.promptDir || path.join(process.cwd(), 'prompt'),
      500
    );
    if (!promptDir) {
      return '';
    }
    return path.resolve(promptDir, `${normalizePromptKey(promptKey)}.md`);
  }

  function readPromptContent(promptPath = '') {
    if (!promptPath || !fs.existsSync(promptPath)) {
      return '';
    }

    try {
      return fs.readFileSync(promptPath, 'utf8');
    } catch (error) {
      logger.warn?.(`[workflow.persona-memory] failed to read prompt file ${promptPath}: ${error.message}`);
      return '';
    }
  }

  function loadState(input = {}) {
    const resolved = resolvePromptKey(input);
    if (!resolved.promptKey) {
      return {
        promptKey: '',
        promptPath: '',
        promptLabel: '',
        basePromptText: '',
        memoryText: '',
        entries: [],
        pendingRounds: [],
        updatedAt: new Date(now()).toISOString()
      };
    }

    const persisted = store.read(resolved.promptKey) || {};
    const fileContent = readPromptContent(resolved.promptPath);
    const parsed = parsePersonaMemoryBlock(fileContent);
    const persistedEntries = normalizeMemoryEntries(persisted.entries || [], {});
    const fileEntries = normalizeMemoryEntries(parsed.entries || [], {});
    const entries = fileEntries.length > 0 ? fileEntries : persistedEntries;
    const pendingRounds = Array.isArray(persisted.pendingRounds)
      ? persisted.pendingRounds
          .map(round => normalizePendingRound(round))
          .filter(Boolean)
      : [];

    return {
      promptKey: resolved.promptKey,
      promptPath: resolved.promptPath,
      promptLabel: resolved.promptLabel || resolved.promptKey,
      basePromptText: parsed.baseContent || fileContent.trimEnd(),
      memoryText: parsed.memoryText || '',
      entries,
      pendingRounds,
      updatedAt: normalizeIsoTime(persisted.updatedAt || now())
    };
  }

  function saveState(state = {}) {
    if (!state.promptKey) {
      return null;
    }

    const snapshot = cloneState({
      ...state,
      updatedAt: normalizeIsoTime(state.updatedAt || now())
    });
    store.write(state.promptKey, snapshot);
    return snapshot;
  }

  function normalizePendingRound(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }

    const timestamp = normalizePositiveInt(input.timestamp, now(), 0);
    const currentMessage = normalizeLineText(input.currentMessage || input.userMessage || input.message || input.cleanedContent, 800);
    const replyText = normalizeLineText(input.replyText || input.responseText || input.botReply, 800);
    const sourceMode = normalizeText(input.sourceMode || input.mode || '', 80);
    const triggerKind = normalizeText(input.triggerKind || input.sourceTriggerKind || '', 80);
    const sourceScope = normalizeText(input.sourceScope || (input.isPrivateSession === true ? 'private' : ''), 80)
      || (sourceMode === 'direct-agent' || sourceMode === 'workflow-chat' || sourceMode === 'hybrid-chat' || sourceMode === 'legacy-chat'
        ? 'public'
        : '');

    return {
      roundId: normalizeText(input.roundId || input.messageId || input.eventId || input.requestId || generateMemoryId('round'), 160),
      timestamp,
      createdAt: normalizeIsoTime(input.createdAt || timestamp),
      sourceMode,
      triggerKind,
      sourceScope,
      channelId: normalizeText(input.channelId || input.chatId || '', 160),
      userId: normalizeText(input.userId || '', 160),
      username: normalizeText(input.username || '', 160),
      currentMessage,
      replyText,
      promptKey: normalizeText(input.promptKey || '', 160)
    };
  }

  function buildSummaryContext(state) {
    return {
      promptKey: state.promptKey,
      promptLabel: state.promptLabel,
      basePromptText: state.basePromptText,
      entries: state.entries,
      pendingRounds: state.pendingRounds,
      maxEntries,
      summaryThresholdRounds,
      summaryThresholdAgeMs
    };
  }

  function buildCompressionContext(state, selectedEntries = []) {
    return {
      promptKey: state.promptKey,
      promptLabel: state.promptLabel,
      basePromptText: state.basePromptText,
      entries: state.entries,
      selectedEntries,
      maxEntries,
      compressionPickCount,
      compressionTargetCount
    };
  }

  function shouldSummarize(state = {}) {
    const rounds = Array.isArray(state.pendingRounds) ? state.pendingRounds : [];
    if (rounds.length < summaryThresholdRounds) {
      return {
        ok: false,
        reason: 'pending rounds below threshold'
      };
    }

    const oldestTimestamp = rounds.reduce((min, round) => {
      const ts = normalizePositiveInt(round?.timestamp, now(), 0);
      return Math.min(min, ts);
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(oldestTimestamp)) {
      return {
        ok: false,
        reason: 'pending rounds missing timestamp'
      };
    }

    if (now() - oldestTimestamp < summaryThresholdAgeMs) {
      return {
        ok: false,
        reason: 'oldest pending round is too recent'
      };
    }

    return { ok: true };
  }

  async function summarizeLocked(state = {}) {
    if (!state.promptKey) {
      return {
        ok: false,
        changed: false,
        reason: 'missing prompt key'
      };
    }

    const gate = shouldSummarize(state);
    if (!gate.ok) {
      return {
        ok: true,
        changed: false,
        reason: gate.reason
      };
    }

    if (!provider || typeof provider.complete !== 'function') {
      logger.warn?.(`[workflow.persona-memory] provider unavailable, skip summary for ${state.promptKey}`);
      return {
        ok: false,
        changed: false,
        reason: 'provider unavailable'
      };
    }

    const summaryPrompt = buildSummaryPrompt(buildSummaryContext(state));
    const result = await provider.complete({
      message: summaryPrompt,
      timeoutMs,
      json: true
    });
    const entries = parseProviderEntries(result);
    const normalized = normalizeMemoryEntries(entries, {
      defaultSourceRoundCount: Array.isArray(state.pendingRounds) ? state.pendingRounds.length : 0
    });

    if (!Array.isArray(normalized) || normalized.length === 0) {
      logger.warn?.(`[workflow.persona-memory] summary provider returned empty entries for ${state.promptKey}`);
      return {
        ok: false,
        changed: false,
        reason: 'summary returned empty entries'
      };
    }

    state.entries = normalizeMemoryEntries([...(state.entries || []), ...normalized], {});
    state.pendingRounds = [];
    state.updatedAt = normalizeIsoTime(now());
    return {
      ok: true,
      changed: true,
      summaryCount: normalized.length,
      roundCount: normalized.reduce((total, entry) => total + normalizePositiveInt(entry.sourceRoundCount, 0, 0), 0) || 0
    };
  }

  async function compressLocked(state = {}) {
    if (!state.promptKey) {
      return {
        ok: false,
        changed: false,
        reason: 'missing prompt key'
      };
    }

    if (!Array.isArray(state.entries) || state.entries.length <= maxEntries) {
      return {
        ok: true,
        changed: false,
        reason: 'within limit'
      };
    }

    if (!provider || typeof provider.complete !== 'function') {
      logger.warn?.(`[workflow.persona-memory] provider unavailable, skip compression for ${state.promptKey}`);
      return {
        ok: false,
        changed: false,
        reason: 'provider unavailable'
      };
    }

    let changed = false;
    let iterations = 0;

    while (Array.isArray(state.entries) && state.entries.length > maxEntries) {
      iterations += 1;
      const ordered = [...state.entries].sort((left, right) => {
        const leftImportance = normalizeImportance(left.importance, 5);
        const rightImportance = normalizeImportance(right.importance, 5);
        if (leftImportance !== rightImportance) {
          return leftImportance - rightImportance;
        }

        const leftTime = new Date(left.createdAt || left.time || 0).getTime();
        const rightTime = new Date(right.createdAt || right.time || 0).getTime();
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }

        return normalizeText(left.id, 160).localeCompare(normalizeText(right.id, 160));
      });

      const selected = ordered.slice(0, compressionPickCount);
      if (selected.length === 0) {
        break;
      }

      const selectedIds = selected.map(entry => normalizeText(entry.id, 160)).filter(Boolean);
      const selectedRoundCount = selected.reduce(
        (total, entry) => total + normalizePositiveInt(entry.sourceRoundCount, 0, 0),
        0
      ) || selected.length;

      const compressionPrompt = buildCompressionPrompt(buildCompressionContext(state, selected));
      const result = await provider.complete({
        message: compressionPrompt,
        timeoutMs,
        json: true
      });
      const parsedEntries = parseProviderEntries(result);
      const replacement = normalizeMemoryEntries(parsedEntries, {
        defaultSourceRoundCount: selectedRoundCount,
        defaultCompressedFrom: selectedIds
      }).slice(0, compressionTargetCount);

      if (replacement.length === 0) {
        logger.warn?.(`[workflow.persona-memory] compression provider returned empty entries for ${state.promptKey}`);
        break;
      }

      const selectedIdSet = new Set(selectedIds);
      state.entries = normalizeMemoryEntries(
        [
          ...state.entries.filter(entry => !selectedIdSet.has(normalizeText(entry.id, 160))),
          ...replacement.map(entry => ({
            ...entry,
            compressedFrom: normalizeCompressedFrom(entry.compressedFrom, selectedIds)
          }))
        ],
        {}
      );
      changed = true;

      if (iterations > 10) {
        logger.warn?.(`[workflow.persona-memory] compression loop exceeded guard for ${state.promptKey}`);
        break;
      }
    }

    if (changed) {
      state.updatedAt = normalizeIsoTime(now());
    }

    return {
      ok: true,
      changed,
      iterations,
      entryCount: Array.isArray(state.entries) ? state.entries.length : 0
    };
  }

  async function rewritePromptFileLocked(state = {}) {
    if (!state.promptKey || !state.promptPath) {
      return {
        ok: false,
        changed: false,
        reason: 'missing prompt file path'
      };
    }

    const currentContent = readPromptContent(state.promptPath) || state.basePromptText || '';
    const nextBlock = serializePersonaMemoryBlock(state.entries || [], {});
    const nextContent = replacePersonaMemoryBlock(currentContent, nextBlock);
    if (normalizeText(nextContent, 200000) === normalizeText(currentContent, 200000)) {
      return {
        ok: true,
        changed: false,
        promptPath: state.promptPath
      };
    }

    fs.mkdirSync(path.dirname(state.promptPath), { recursive: true });
    fs.writeFileSync(state.promptPath, `${nextContent.trimEnd()}\n`, 'utf8');
    state.memoryText = nextBlock;
    state.basePromptText = parsePersonaMemoryBlock(nextContent).baseContent || nextContent.trimEnd();
    state.updatedAt = normalizeIsoTime(now());
    return {
      ok: true,
      changed: true,
      promptPath: state.promptPath,
      memoryCount: Array.isArray(state.entries) ? state.entries.length : 0
    };
  }

  async function processLocked(state = {}) {
    const summaryResult = await summarizeLocked(state);
    const compressionResult = await compressLocked(state);
    let rewriteResult = {
      ok: true,
      changed: false
    };

    if (summaryResult.changed || compressionResult.changed) {
      rewriteResult = await rewritePromptFileLocked(state);
      saveState(state);
    } else {
      saveState(state);
    }

    return {
      ok: true,
      changed: summaryResult.changed || compressionResult.changed || rewriteResult.changed,
      summaryResult,
      compressionResult,
      rewriteResult,
      state: cloneState(state)
    };
  }

  function getSnapshot(input = {}) {
    const state = loadState(input);
    return cloneState({
      ...state,
      memoryText: state.memoryText || serializePersonaMemoryBlock(state.entries || [], {}),
      entries: state.entries || [],
      pendingRounds: state.pendingRounds || []
    });
  }

  async function recordRound(input = {}) {
    const mode = normalizeText(input.sourceMode || input.mode || '', 80);
    const triggerKind = normalizeText(input.triggerKind || input.sourceTriggerKind || '', 80);
    const allowedModes = new Set(['workflow-chat', 'direct-agent', 'hybrid-chat', 'legacy-chat']);
    const allowedTriggers = new Set(['message.mentioned', 'message.private']);

    if (mode && !allowedModes.has(mode)) {
      return {
        ok: true,
        recorded: false,
        reason: `unsupported source mode: ${mode}`
      };
    }

    if (triggerKind && !allowedTriggers.has(triggerKind)) {
      return {
        ok: true,
        recorded: false,
        reason: `unsupported trigger kind: ${triggerKind}`
      };
    }

    return enqueue(input.promptKey, async () => {
      const state = loadState(input);
      if (!state.promptKey) {
        return {
          ok: false,
          recorded: false,
          reason: 'missing prompt key'
        };
      }

      const round = normalizePendingRound({
        ...input,
        sourceMode: mode,
        triggerKind,
        promptKey: state.promptKey
      });
      if (!round) {
        return {
          ok: false,
          recorded: false,
          reason: 'invalid round payload'
        };
      }

      state.pendingRounds = [...(state.pendingRounds || []), round];
      state.updatedAt = normalizeIsoTime(now());
      saveState(state);
      const processResult = await processLocked(state);
      return {
        ok: true,
        recorded: true,
        promptKey: state.promptKey,
        promptPath: state.promptPath,
        round,
        summaryResult: processResult.summaryResult,
        compressionResult: processResult.compressionResult,
        rewriteResult: processResult.rewriteResult,
        state: processResult.state
      };
    });
  }

  async function maybeSummarize(input = {}) {
    return enqueue(input.promptKey, async () => {
      const state = loadState(input);
      const summaryResult = await summarizeLocked(state);
      const compressionResult = summaryResult.changed ? await compressLocked(state) : { ok: true, changed: false, reason: 'summary not triggered' };
      let rewriteResult = { ok: true, changed: false };

      if (summaryResult.changed || compressionResult.changed) {
        rewriteResult = await rewritePromptFileLocked(state);
        saveState(state);
      } else {
        saveState(state);
      }

      return {
        ok: true,
        changed: summaryResult.changed || compressionResult.changed || rewriteResult.changed,
        summaryResult,
        compressionResult,
        rewriteResult,
        state: cloneState(state)
      };
    });
  }

  async function compressIfNeeded(input = {}) {
    return enqueue(input.promptKey, async () => {
      const state = loadState(input);
      const compressionResult = await compressLocked(state);
      let rewriteResult = { ok: true, changed: false };

      if (compressionResult.changed) {
        rewriteResult = await rewritePromptFileLocked(state);
        saveState(state);
      } else {
        saveState(state);
      }

      return {
        ok: true,
        changed: compressionResult.changed || rewriteResult.changed,
        compressionResult,
        rewriteResult,
        state: cloneState(state)
      };
    });
  }

  async function rewritePromptFile(input = {}) {
    return enqueue(input.promptKey, async () => {
      const state = loadState(input);
      const rewriteResult = await rewritePromptFileLocked(state);
      saveState(state);
      return {
        ok: true,
        changed: rewriteResult.changed,
        rewriteResult,
        state: cloneState(state)
      };
    });
  }

  return {
    name: 'workflow.persona-memory',
    store,
    setProvider(nextProvider) {
      provider = nextProvider || null;
      return provider;
    },
    setPromptProfileService(nextService) {
      promptProfileService = nextService || null;
      return promptProfileService;
    },
    resolvePromptProfileSnapshot,
    resolvePromptKey,
    getSnapshot,
    loadState,
    saveState,
    recordRound,
    maybeSummarize,
    compressIfNeeded,
    rewritePromptFile
  };
}

module.exports = {
  MEMORY_BLOCK_OPEN,
  MEMORY_BLOCK_CLOSE,
  SUMMARY_THRESHOLD_ROUNDS,
  SUMMARY_THRESHOLD_AGE_MS,
  COMPRESSION_PICK_COUNT,
  COMPRESSION_TARGET_COUNT,
  DEFAULT_MAX_ENTRIES,
  normalizeText,
  normalizeLineText,
  normalizePositiveInt,
  normalizeImportance,
  normalizeIsoTime,
  normalizeCompressedFrom,
  normalizeMemoryEntry,
  normalizeMemoryEntries,
  serializePersonaMemoryBlock,
  parsePersonaMemoryBlock,
  replacePersonaMemoryBlock,
  buildSummaryPrompt,
  buildCompressionPrompt,
  createPersonaMemoryService
};
