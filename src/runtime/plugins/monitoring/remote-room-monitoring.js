/**
 * Remote Room Monitoring Plugin
 * 管理员私聊指令：查看房间状况
 * 默认查询 bot 当前所在房间最近消息，并生成管理员审查报告。
 */

const { createToolResult } = require('../../../contracts/tool');
const { isAdminUser } = require('../../policy/access');
const { callInternal } = require('../../../services/iirose/internal');
const { safeParse, extractJson } = require('../../../utils/json-utils');
const { OpenAICompatibleProvider } = require('../../../ai/providers/openai-compatible-provider');

const DEFAULT_TIME_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MESSAGE_LIMIT = 50;
const DEFAULT_PROVIDER_TIMEOUT_MS = 20000;
const DEFAULT_EVIDENCE_LIMIT = 3;
const DEFAULT_ANALYZE_RETRIES = 1;

const RISK_RULES = [
  {
    label: '暴力或自伤',
    level: 'high',
    patterns: [/去死/u, /杀了/u, /砍死/u, /自杀/u, /轻生/u, /弄死/u]
  },
  {
    label: '人身攻击',
    level: 'attention',
    patterns: [/傻逼/u, /废物/u, /脑残/u, /弱智/u, /垃圾/u, /滚出去/u, /操你/u]
  },
  {
    label: '性骚扰或未成年人风险',
    level: 'high',
    patterns: [/强奸/u, /轮奸/u, /裸照/u, /约炮/u, /性骚扰/u, /未成年/u]
  },
  {
    label: '隐私泄露或开盒',
    level: 'high',
    patterns: [/开盒/u, /人肉/u, /住址/u, /身份证/u, /手机号/u, /电话号/u, /微信号/u]
  }
];

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function uniqueStrings(items = []) {
  return [...new Set(
    items
      .map(item => String(item || '').trim())
      .filter(Boolean)
  )];
}

function normalizeRiskLevel(value, fallback = 'none') {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'high' || text === 'attention' || text === 'none') {
    return text;
  }
  return fallback;
}

function normalizeProviderName(value) {
  const text = String(value || '').trim().toLowerCase();
  return text || 'openclaw';
}

function extractRoomId(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return '';

  const sharpMatch = text.match(/<sharp\b[^>]*\bid=["']?([^"'>\s]+)["']?[^>]*\/?>/iu);
  if (sharpMatch?.[1]) {
    return sharpMatch[1].trim();
  }

  const plainIdMatch = text.match(/[0-9a-f]{8,32}/iu);
  if (plainIdMatch?.[0]) {
    return plainIdMatch[0].trim();
  }

  return '';
}

function pickExplicitRoomId(input = {}) {
  const candidates = [
    input.roomId,
    input.targetRoom,
    input.channelId,
    input.query,
    input.raw
  ];

  for (const candidate of candidates) {
    const roomId = extractRoomId(candidate);
    if (roomId) {
      return roomId;
    }
  }

  return '';
}

function formatTimeLabel(timestamp) {
  const num = Number(timestamp);
  if (!Number.isFinite(num) || num <= 0) return '';
  return new Date(num).toLocaleTimeString('zh-CN', {
    hour12: false
  });
}

function getTimeWindowText(metadata = {}) {
  const label = typeof metadata.timeWindowLabel === 'string' ? metadata.timeWindowLabel.trim() : '';
  return label || '最近 15 分钟';
}

function formatMessagesForPrompt(messages = []) {
  return messages.map((message) => {
    const role = message.role === 'assistant'
      ? 'BOT'
      : (message.username || '用户');
    const timeLabel = formatTimeLabel(message.timestamp);
    const userLabel = message.userId ? `${role}(uid=${message.userId})` : role;
    const content = String(message.content || '').trim();
    return `[${timeLabel}] ${userLabel}: ${content}`;
  }).join('\n');
}

function getRiskMatches(messages = []) {
  const matches = [];

  for (const message of messages) {
    const content = String(message.content || '').trim();
    if (!content) continue;

    for (const rule of RISK_RULES) {
      if (!rule.patterns.some(pattern => pattern.test(content))) {
        continue;
      }

      matches.push({
        level: rule.level,
        label: rule.label,
        content,
        user: message.username || '未知用户',
        timestamp: message.timestamp
      });
    }
  }

  return matches;
}

function extractTopics(messages = []) {
  const text = messages.map(item => String(item.content || '').trim()).join('\n');
  const topics = [];

  if (/点歌|歌曲|歌词|音乐/u.test(text)) topics.push('点歌/音乐');
  if (/房间|切房|跳房|转房/u.test(text)) topics.push('房间操作');
  if (/任务|论坛|排行榜/u.test(text)) topics.push('系统功能');
  if (/bot|机器人|你/u.test(text)) topics.push('机器人互动');

  return topics.length > 0 ? topics : ['日常聊天'];
}

function buildHeuristicAnalysis(roomId, messages = [], metadata = {}, evidenceLimit = DEFAULT_EVIDENCE_LIMIT) {
  const timeWindowText = getTimeWindowText(metadata);
  const riskMatches = getRiskMatches(messages);
  const topics = extractTopics(messages);
  const hasRisk = riskMatches.length > 0;
  const riskLevel = riskMatches.some(item => item.level === 'high')
    ? 'high'
    : (hasRisk ? 'attention' : 'none');
  const evidence = uniqueStrings(
    riskMatches.slice(0, evidenceLimit).map((item) => {
      const timeLabel = formatTimeLabel(item.timestamp);
      return `[${timeLabel}] ${item.user}: ${item.content}`;
    })
  );
  const summary = hasRisk
    ? `房间 ${roomId} ${timeWindowText}内讨论整体活跃，主要围绕 ${topics.join('、')}，并出现需要关注的越界信号。`
    : `房间 ${roomId} ${timeWindowText}内主要围绕 ${topics.join('、')} 交流，暂未发现明显过激或越界内容。`;
  const riskDetails = hasRisk
    ? `命中 ${uniqueStrings(riskMatches.map(item => item.label)).join('、')} 相关表述，需要管理员复核。`
    : '未命中明显风险关键词，整体偏日常交流。';

  return {
    summary,
    topics,
    hasRisk,
    riskLevel,
    riskDetails,
    evidence,
    recommendation: hasRisk
      ? '建议管理员回看证据摘录，并结合完整上下文判断是否需要提醒、降温或人工介入。'
      : '暂无需立即干预，可继续观察。',
    tone: hasRisk ? '存在摩擦或越界苗头' : '整体平稳',
    source: 'heuristic'
  };
}

function extractJsonPayload(text = '') {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const direct = safeParse(text);
  if (direct) {
    return direct;
  }

  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const objectPayload = safeParse(text.slice(objectStart, objectEnd + 1));
    if (objectPayload) {
      return objectPayload;
    }
  }

  return extractJson(text);
}

function normalizeProviderAnalysis(payload, fallback) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const topics = Array.isArray(payload.topics)
    ? uniqueStrings(payload.topics)
    : fallback.topics;
  const evidence = Array.isArray(payload.evidence)
    ? uniqueStrings(payload.evidence)
    : fallback.evidence;
  const hasRisk = typeof payload.hasRisk === 'boolean'
    ? payload.hasRisk
    : fallback.hasRisk;
  const riskLevel = normalizeRiskLevel(payload.riskLevel, hasRisk ? 'attention' : 'none');

  return {
    summary: typeof payload.summary === 'string' && payload.summary.trim()
      ? payload.summary.trim()
      : fallback.summary,
    topics,
    hasRisk,
    riskLevel,
    riskDetails: typeof payload.riskDetails === 'string' && payload.riskDetails.trim()
      ? payload.riskDetails.trim()
      : fallback.riskDetails,
    evidence: evidence.length > 0 ? evidence : fallback.evidence,
    recommendation: typeof payload.recommendation === 'string' && payload.recommendation.trim()
      ? payload.recommendation.trim()
      : fallback.recommendation,
    tone: typeof payload.tone === 'string' && payload.tone.trim()
      ? payload.tone.trim()
      : fallback.tone,
    source: payload.source || fallback.source,
    provider: normalizeProviderName(payload.provider || fallback.provider || '')
  };
}

function isUsableProviderAnalysis(analysis = {}) {
  return typeof analysis.summary === 'string'
    && analysis.summary.trim().length >= 8
    && Array.isArray(analysis.topics)
    && analysis.topics.length > 0
    && typeof analysis.hasRisk === 'boolean';
}

function buildProviderPrompt(roomId, messages = [], metadata = {}, heuristic = {}) {
  const transcript = formatMessagesForPrompt(messages);
  const lines = [
    '你是聊天室审查助手，需要给管理员生成中文房间状况报告。',
    '请结合聊天记录，概括讨论主题，并判断是否存在过激、越界、攻击、骚扰、色情、隐私泄露、煽动冲突、自伤他伤等风险。',
    '如果证据不足，不要夸大风险。',
    '只输出 JSON，不要输出 markdown 代码块。',
    'JSON schema:',
    '{"summary":"", "topics":[""], "hasRisk":false, "riskLevel":"none|attention|high", "riskDetails":"", "evidence":[""], "recommendation":"", "tone":""}',
    '',
    `房间 ID: ${roomId}`,
    `时间范围: ${metadata.timeWindowLabel || '最近 15 分钟'}`,
    `消息数量: ${messages.length}`,
    `启发式预判摘要: ${heuristic.summary || '无'}`,
    `启发式风险说明: ${heuristic.riskDetails || '无'}`,
    '',
    '聊天记录:',
    transcript
  ];

  return lines.join('\n');
}

function buildProviderRetryPrompt(roomId, messages, metadata, heuristic, lastError = '', lastText = '') {
  const basePrompt = buildProviderPrompt(roomId, messages, metadata, heuristic);
  const lines = [
    basePrompt,
    '',
    '上一次输出未通过系统校验，请重新生成。',
    '这次必须只输出一个 JSON object，且字段完整。',
    '不要输出 markdown 代码块，不要输出解释，不要输出额外前后缀。',
    '如果证据不足，也必须返回合法 JSON，而不是空回复。',
    `上一次失败原因: ${String(lastError || 'unknown').slice(0, 300)}`
  ];

  if (String(lastText || '').trim()) {
    lines.push(`上一次原始输出摘录: ${String(lastText).slice(0, 400)}`);
  }

  return lines.join('\n');
}

async function analyzeWithProvider(provider, roomId, messages, metadata, heuristic, options = {}) {
  if (!provider || typeof provider.complete !== 'function') {
    return {
      ok: false,
      analysis: null,
      error: 'provider unavailable',
      attempts: 0
    };
  }

  const timeoutMs = toPositiveInt(options.providerTimeoutMs, DEFAULT_PROVIDER_TIMEOUT_MS);
  const maxRetries = Math.max(0, toPositiveInt(options.maxRetries, DEFAULT_ANALYZE_RETRIES));
  let lastError = '';
  let lastText = '';
  let lastProvider = '';

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const prompt = attempt === 0
      ? buildProviderPrompt(roomId, messages, metadata, heuristic)
      : buildProviderRetryPrompt(roomId, messages, metadata, heuristic, lastError, lastText);

    let result = null;
    try {
      result = await provider.complete({
        message: prompt,
        json: true,
        timeoutMs,
        sessionId: `room-monitor-${roomId}`
      });
    } catch (error) {
      lastError = error.message || 'provider request failed';
      continue;
    }

    if (!result) {
      lastError = 'provider returned empty result';
      continue;
    }

    lastProvider = normalizeProviderName(result.provider);
    lastText = String(result.text || result.jsonText || result.plainText || '').trim();
    const payload = extractJsonPayload(lastText)
      || result.json
      || extractJsonPayload(String(result.raw?.stdout || result.raw || ''));
    const parsed = normalizeProviderAnalysis(payload, {
      ...heuristic,
      provider: lastProvider
    });

    if (parsed && isUsableProviderAnalysis(parsed)) {
      return {
        ok: true,
        analysis: {
          ...parsed,
          source: 'llm',
          provider: lastProvider
        },
        error: '',
        attempts: attempt + 1
      };
    }

    lastError = result.ok === false
      ? (result.error || 'provider returned error')
      : 'provider output did not match monitoring JSON schema';
  }

  return {
    ok: false,
    analysis: null,
    error: lastError || 'provider returned no valid monitoring analysis',
    provider: lastProvider,
    attempts: maxRetries + 1
  };
}

function riskLabel(level = 'none') {
  if (level === 'high') return '高风险';
  if (level === 'attention') return '需关注';
  return '未见明显风险';
}

function renderMonitoringReport(roomId, analysis, metadata = {}) {
  const lines = [
    '房间状况报告',
    `房间: ${roomId}`,
    `范围: ${metadata.timeWindowLabel || '最近 15 分钟'}，${metadata.returned || 0} 条消息`
  ];

  if (metadata.startLabel || metadata.endLabel) {
    lines.push(`时间: ${metadata.startLabel || '?'} - ${metadata.endLabel || '?'}`);
  }

  lines.push(
    '',
    `讨论摘要: ${analysis.summary}`,
    `主要话题: ${(analysis.topics || []).join('、') || '未提取'}`,
    `风险判断: ${riskLabel(analysis.riskLevel)}`
  );

  if (analysis.riskDetails) {
    lines.push(`风险说明: ${analysis.riskDetails}`);
  }

  if (Array.isArray(analysis.evidence) && analysis.evidence.length > 0) {
    lines.push('', '证据摘录:');
    analysis.evidence.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  }

  if (analysis.recommendation) {
    lines.push('', `建议: ${analysis.recommendation}`);
  }

  if (analysis.source === 'heuristic-fallback' && analysis.llmError) {
    lines.push('', `LLM 状态: 本次 LLM 分析失败，以下为规则兜底结果。`);
    lines.push(`失败原因: ${String(analysis.llmError).slice(0, 200)}`);
  }

  if (analysis.source === 'llm') {
    lines.push('', `分析来源: llm/${analysis.provider || 'openclaw'}`);
  } else {
    lines.push('', `分析来源: ${analysis.source || 'heuristic'}`);
  }

  return lines.join('\n');
}

function renderLlmFailureReport(roomId, metadata = {}, error = '') {
  const lines = [
    '房间状况报告',
    `房间: ${roomId}`,
    `范围: ${getTimeWindowText(metadata)}，${metadata.returned || 0} 条消息`
  ];

  if (metadata.startLabel || metadata.endLabel) {
    lines.push(`时间: ${metadata.startLabel || '?'} - ${metadata.endLabel || '?'}`);
  }

  lines.push(
    '',
    'LLM 状态: 本次分析失败，未生成正式 LLM 报告。',
    `失败原因: ${String(error || 'unknown').slice(0, 300)}`,
    '',
    '建议: 请稍后重试；如果持续失败，需要检查 OpenClaw/provider 配置或输出格式。'
  );

  return lines.join('\n');
}

async function getRecentMessages(contextService, roomId, options = {}) {
  if (!contextService || typeof contextService.getMessagesInWindow !== 'function') {
    return {
      ok: false,
      error: '会话存储服务不可用',
      messages: []
    };
  }

  const timeWindowMs = toPositiveInt(options.timeWindowMs, DEFAULT_TIME_WINDOW_MS);
  const limit = Math.min(toPositiveInt(options.messageLimit, DEFAULT_MESSAGE_LIMIT), DEFAULT_MESSAGE_LIMIT);
  const now = Date.now();
  const fromTs = now - timeWindowMs;

  try {
    const allMessagesRaw = await Promise.resolve(
      contextService.getMessagesInWindow(roomId, fromTs, now, {})
    );
    const allMessages = Array.isArray(allMessagesRaw) ? allMessagesRaw : [];
    const messages = allMessages.slice(-limit);

    return {
      ok: true,
      messages,
      error: '',
      metadata: {
        roomId,
        fromTs,
        toTs: now,
        timeWindowMs,
        timeWindowLabel: `最近 ${Math.max(1, Math.round(timeWindowMs / 60000))} 分钟`,
        totalFound: allMessages.length,
        returned: messages.length,
        startLabel: formatTimeLabel(messages[0]?.timestamp),
        endLabel: formatTimeLabel(messages[messages.length - 1]?.timestamp)
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      messages: []
    };
  }
}

async function resolveTargetRoomId(session, input = {}, config = {}) {
  const explicitRoomId = pickExplicitRoomId(input);
  if (explicitRoomId && !explicitRoomId.startsWith('private:')) {
    return explicitRoomId;
  }

  try {
    const liveRoomId = await callInternal(session, 'getRoomId');
    const resolved = extractRoomId(liveRoomId) || String(liveRoomId || '').trim();
    if (resolved && !resolved.startsWith('private:')) {
      return resolved;
    }
  } catch {
    // fallback below
  }

  const fallbackRoomId = extractRoomId(config.roomId || config.defaultRoomId || session?.channelId)
    || String(config.roomId || config.defaultRoomId || session?.channelId || '').trim();
  if (fallbackRoomId && !fallbackRoomId.startsWith('private:')) {
    return fallbackRoomId;
  }

  return '';
}

function resolveProviderFactory(host, context, pluginConfig = {}) {
  let cachedProvider;
  let resolved = false;

  return function resolveProvider() {
    if (resolved) {
      return cachedProvider;
    }

    resolved = true;
    const config = context.config || {};
    const logger = context.logger || host.logger || console;

    if (pluginConfig.provider === false) {
      cachedProvider = null;
      return cachedProvider;
    }

    if (pluginConfig.provider && typeof pluginConfig.provider.complete === 'function') {
      cachedProvider = pluginConfig.provider;
      return cachedProvider;
    }

    const directProvider = config.workflow?.provider;
    if (directProvider && typeof directProvider.complete === 'function') {
      cachedProvider = directProvider;
      return cachedProvider;
    }

    if (typeof config.workflow?.providerFactory === 'function') {
      const provided = config.workflow.providerFactory({
        config,
        logger,
        ctx: context.ctx || null,
        host
      });
      if (provided && typeof provided.complete === 'function') {
        cachedProvider = provided;
        return cachedProvider;
      }
    }

    const providerName = typeof pluginConfig.provider === 'string' && pluginConfig.provider.trim()
      ? pluginConfig.provider.trim().toLowerCase()
      : (typeof config.workflow?.provider === 'string' && config.workflow.provider.trim()
        ? config.workflow.provider.trim().toLowerCase()
        : (typeof config.providers?.default === 'string' && config.providers.default.trim()
          ? config.providers.default.trim().toLowerCase()
          : 'openclaw'));

    const namedProviderConfig = config.providers?.named && typeof config.providers.named === 'object'
      ? config.providers.named[providerName]
      : null;
    const namedProviderType = typeof namedProviderConfig?.type === 'string'
      ? namedProviderConfig.type.trim().toLowerCase()
      : 'openai-compatible';

    if (
      namedProviderConfig &&
      typeof namedProviderConfig === 'object' &&
      namedProviderConfig.enabled !== false &&
      (namedProviderType === 'openai-compatible' || namedProviderType === 'openai')
    ) {
      cachedProvider = new OpenAICompatibleProvider({
        provider: providerName,
        label: providerName,
        baseUrl: namedProviderConfig.baseUrl,
        apiKey: namedProviderConfig.apiKey,
        model: namedProviderConfig.model,
        endpointPath: namedProviderConfig.endpointPath,
        headers: namedProviderConfig.headers,
        headerOverrides: namedProviderConfig.headerOverrides || namedProviderConfig.requestHeaders,
        extraBody: namedProviderConfig.extraBody,
        timeout: namedProviderConfig.timeout,
        maxTokens: namedProviderConfig.maxTokens,
        thinking: namedProviderConfig.thinking,
        responseMode: namedProviderConfig.responseMode,
        jsonMode: namedProviderConfig.jsonMode,
        allowEmptyFinal: namedProviderConfig.allowEmptyFinal,
        logger
      });
      return cachedProvider;
    }

    const registeredProvider = host.getProvider?.(providerName);
    if (!registeredProvider) {
      cachedProvider = null;
      return cachedProvider;
    }

    if (typeof registeredProvider === 'function') {
      const provided = registeredProvider({
        config,
        logger,
        ctx: context.ctx || null,
        host
      });
      cachedProvider = provided && typeof provided.complete === 'function'
        ? provided
        : null;
      return cachedProvider;
    }

    cachedProvider = typeof registeredProvider.complete === 'function'
      ? registeredProvider
      : null;
    return cachedProvider;
  };
}

function createRoomMonitoringService(options = {}) {
  const config = options.config || {};
  const pluginConfig = options.pluginConfig || {};
  const logger = options.logger || console;
  const resolveProvider = typeof options.resolveProvider === 'function'
    ? options.resolveProvider
    : (() => null);

  return {
    async analyze(context = {}, input = {}) {
      const contextService = context.contextService
        || context.conversationStore
        || context.sendOptions?.conversationStore
        || null;
      const roomId = await resolveTargetRoomId(context.session, input, config);
      if (!roomId) {
        return {
          ok: false,
          error: '无法确定目标房间。请直接发送“查看房间状况 房间ID”，或确认 bot 当前已在目标房间。',
          data: {
            roomId: '',
            hasRisk: false,
            riskLevel: 'none'
          }
        };
      }

      const historyResult = await getRecentMessages(contextService, roomId, {
        timeWindowMs: pluginConfig.timeWindowMs,
        messageLimit: input.messageLimit || pluginConfig.messageLimit
      });
      if (!historyResult.ok) {
        return {
          ok: false,
          error: `获取消息失败：${historyResult.error}`,
          data: {
            roomId,
            hasRisk: false,
            riskLevel: 'none'
          }
        };
      }

      const messages = historyResult.messages;
      const metadata = historyResult.metadata || {};
      if (messages.length === 0) {
        const emptyText = `房间 ${roomId} ${metadata.timeWindowLabel || '最近 15 分钟'}内暂无消息记录。`;
        return {
          ok: true,
          roomId,
          reportText: emptyText,
          summary: emptyText,
          analysis: {
            summary: emptyText,
            topics: [],
            hasRisk: false,
            riskLevel: 'none',
            riskDetails: '',
            evidence: [],
            recommendation: '暂无需处理。',
            tone: '安静',
            source: 'heuristic'
          },
          metadata
        };
      }

      const heuristic = buildHeuristicAnalysis(
        roomId,
        messages,
        metadata,
        toPositiveInt(pluginConfig.evidenceLimit, DEFAULT_EVIDENCE_LIMIT)
      );
      let analysis = heuristic;
      const requireLlm = pluginConfig.requireLlm !== false;

      const provider = resolveProvider();
      const providerResult = await analyzeWithProvider(
        provider,
        roomId,
        messages,
        metadata,
        heuristic,
        {
          providerTimeoutMs: pluginConfig.providerTimeoutMs,
          maxRetries: pluginConfig.maxAnalyzeRetries
        }
      );

      if (providerResult.ok && providerResult.analysis) {
        analysis = providerResult.analysis;
      } else if (requireLlm) {
        logger.warn?.(`[remote-room-monitoring] llm analysis unavailable: ${providerResult.error}`);
        return {
          ok: true,
          roomId,
          reportText: renderLlmFailureReport(roomId, metadata, providerResult.error),
          summary: 'LLM 分析失败',
          analysis: {
            ...heuristic,
            summary: 'LLM 分析失败，未生成正式 LLM 报告。',
            recommendation: '请稍后重试；如果持续失败，需要检查 OpenClaw/provider 配置或输出格式。',
            source: 'llm-error',
            provider: normalizeProviderName(providerResult.provider),
            llmError: providerResult.error
          },
          metadata
        };
      } else if (providerResult.error) {
        logger.warn?.(`[remote-room-monitoring] fallback to heuristic: ${providerResult.error}`);
        analysis = {
          ...heuristic,
          source: 'heuristic-fallback',
          provider: normalizeProviderName(providerResult.provider),
          llmError: providerResult.error
        };
      }

      const reportText = renderMonitoringReport(roomId, analysis, metadata);
      return {
        ok: true,
        roomId,
        reportText,
        summary: analysis.summary,
        analysis,
        metadata
      };
    }
  };
}

function createRoomMonitoringTool(options = {}) {
  const config = options.config || {};
  const monitoringService = options.monitoringService;

  return {
    name: 'monitoring.room.analyze',
    description: '分析当前或指定房间最近消息，总结讨论话题并检测是否存在过激、越界风险。仅限管理员使用。',
    aliases: ['查看房间状况', '房间监控', '房间分析', '监控房间'],
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string', description: '可选。目标房间 ID；默认使用 bot 当前所在房间。' },
        messageLimit: { type: 'number', default: DEFAULT_MESSAGE_LIMIT, description: '分析消息数量，最大 50 条。' },
        query: { type: 'string' },
        raw: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        summary: { type: 'string' },
        topics: { type: 'array' },
        hasRisk: { type: 'boolean' },
        riskLevel: { type: 'string' },
        riskDetails: { type: 'string' }
      }
    },
    permission: ['admin'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 60000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['查看房间状况'],
      workflowVisible: true,
      adminOnly: true
    },
    async execute(context = {}, input = {}) {
      const userId = context.session?.user?.id || context.session?.userId || context.userId || '';
      if (!isAdminUser(config, userId)) {
        return createToolResult({
          ok: false,
          name: 'monitoring.room.analyze',
          error: '权限不足：此功能仅限管理员使用'
        });
      }

      const report = await monitoringService.analyze(context, input);
      if (!report.ok) {
        return createToolResult({
          ok: false,
          name: 'monitoring.room.analyze',
          error: report.error,
          data: report.data || null
        });
      }

      return createToolResult({
        ok: true,
        name: 'monitoring.room.analyze',
        result: null,
        summary: `房间 ${report.roomId}: ${report.summary}`,
        data: {
          roomId: report.roomId,
          summary: report.analysis.summary,
          topics: report.analysis.topics,
          hasRisk: report.analysis.hasRisk,
          riskLevel: report.analysis.riskLevel,
          riskDetails: report.analysis.riskDetails,
          evidence: report.analysis.evidence,
          recommendation: report.analysis.recommendation,
          source: report.analysis.source,
          metadata: report.metadata
        },
        outputs: [
          {
            kind: 'reply.current',
            content: {
              text: report.reportText,
              useMemePipeline: false
            },
            options: {
              recordConversation: false
            }
          }
        ]
      });
    }
  };
}

module.exports = {
  name: 'remote-room-monitoring',
  apply(host, context) {
    const scopedConfig = context.getPluginConfig({});
    const pluginConfig = {
      messageLimit: toPositiveInt(scopedConfig.messageLimit, DEFAULT_MESSAGE_LIMIT),
      timeWindowMs: toPositiveInt(
        scopedConfig.timeWindowMs,
        toPositiveInt(scopedConfig.timeWindowMinutes, 15) * 60 * 1000
      ),
      providerTimeoutMs: toPositiveInt(
        scopedConfig.providerTimeoutMs,
        DEFAULT_PROVIDER_TIMEOUT_MS
      ),
      maxAnalyzeRetries: toPositiveInt(
        scopedConfig.maxAnalyzeRetries,
        DEFAULT_ANALYZE_RETRIES
      ),
      evidenceLimit: toPositiveInt(
        scopedConfig.evidenceLimit,
        DEFAULT_EVIDENCE_LIMIT
      ),
      provider: scopedConfig.provider,
      requireLlm: scopedConfig.requireLlm !== false
    };
    const resolveProvider = resolveProviderFactory(host, context, pluginConfig);
    const monitoringService = createRoomMonitoringService({
      config: context.config,
      pluginConfig,
      logger: context.logger || host.logger || console,
      resolveProvider
    });

    host.registerService('monitoring.room', monitoringService);

    context.registerToolPackage({
      name: 'remote-room-monitoring-package',
      version: '0.2.0',
      tools: [
        createRoomMonitoringTool({
          config: context.config,
          monitoringService
        })
      ],
      skills: [
        {
          id: 'observability.room-monitoring',
          name: '房间观察',
          summary: '分析当前或指定房间最近消息，提取话题与风险信息。',
          toolNames: ['monitoring.room.analyze'],
          tags: ['monitoring', 'observability', 'moderation'],
          adminOnly: true,
          examples: ['查看当前房间状况', '分析这个房间最近讨论了什么'],
          metadata: {
            priority: 85,
            pluginName: 'remote-room-monitoring'
          }
        }
      ],
      metadata: {
        pluginName: 'remote-room-monitoring',
        adminOnly: true,
        description: '房间监控与异常检测（管理员私聊查看当前房间或指定房间）'
      }
    });

    host.logger?.INFO?.('MONITORING', 'Remote room monitoring plugin loaded');
  }
};
