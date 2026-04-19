/**
 * Runtime message handler
 * 负责 workflow 模式下的 direct tool 命中与聊天 workflow 触发
 */

const { buildChatProtocolRequest } = require('../workflow/chat-request');

function extractKeywordArgs(message, aliases = []) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) {
    return { query: '', keyword: '', song: '', raw: '' };
  }

  let raw = text;
  for (const alias of aliases) {
    const normalizedAlias = String(alias || '').trim();
    if (!normalizedAlias) continue;
    if (text.toLowerCase().startsWith(normalizedAlias.toLowerCase())) {
      raw = text.slice(normalizedAlias.length).trim();
      break;
    }
  }

  return {
    query: raw,
    keyword: raw,
    song: raw,
    raw
  };
}

async function sendReplyThroughRuntime(outputRuntime, executionContext, text, options = {}) {
  return outputRuntime.execute({
    kind: 'reply.current',
    content: {
      text,
      useMemePipeline: options.useMemePipeline === true,
      renderMode: typeof options.renderMode === 'string' ? options.renderMode : ''
    },
    options: {
      recordConversation: options.recordConversation !== false
    }
  }, executionContext);
}

function extractWorkflowReplyText(workflowResult = {}) {
  const directResult = workflowResult?.outputResult || null;
  const finalResults = Array.isArray(workflowResult?.finalOutputResults) ? workflowResult.finalOutputResults : [];
  const candidates = [];

  if (directResult) {
    candidates.push(directResult);
  }
  candidates.push(...finalResults);

  const recordableKinds = new Set(['reply.current', 'message.route']);
  const texts = [];
  for (const item of candidates) {
    const operation = item?.operation || {};
    if (!recordableKinds.has(operation.kind)) {
      continue;
    }
    const text = typeof operation.metadata?.recordText === 'string' && operation.metadata.recordText.trim()
      ? operation.metadata.recordText.trim()
      : (typeof operation.content?.text === 'string' ? operation.content.text.trim() : '');
    if (text) {
      texts.push(text);
    }
  }

  return texts.join('\n').trim();
}

function schedulePersonaMemoryWriteback(options = {}, payload = {}) {
  const promptMemoryService = options.promptMemoryService || null;
  if (!promptMemoryService || typeof promptMemoryService.recordRound !== 'function') {
    return null;
  }

  const promptProfileSnapshot = options.promptProfileSnapshot || options.promptProfileService?.resolveProfile?.() || null;
  const promptKey = String(payload.promptKey || promptProfileSnapshot?.activePrompt || promptProfileSnapshot?.activePromptFile?.key || '').trim();
  if (!promptKey) {
    return null;
  }

  const replyText = typeof payload.replyText === 'string' ? payload.replyText.trim() : '';
  if (!replyText) {
    return null;
  }

  const trigger = options.trigger || {};
  const session = options.session || {};
  const timestamp = Number.isFinite(Number(payload.timestamp))
    ? Math.floor(Number(payload.timestamp))
    : (Number.isFinite(Number(trigger.timestamp)) ? Math.floor(Number(trigger.timestamp)) : Date.now());

  return promptMemoryService.recordRound({
    promptKey,
    promptLabel: payload.promptLabel || promptProfileSnapshot?.styleLabel || promptProfileSnapshot?.activePromptFile?.label || '',
    sourceMode: payload.sourceMode || '',
    triggerKind: payload.triggerKind || trigger.kind || '',
    sourceScope: payload.sourceScope || (trigger.isPrivateSession === true ? 'private' : 'public'),
    channelId: payload.channelId || trigger.channelId || session.channelId || session.chatId || '',
    userId: payload.userId || trigger.userId || session.userId || '',
    username: payload.username || trigger.username || session.username || '',
    currentMessage: payload.currentMessage || trigger.cleanedContent || trigger.rawContent || '',
    replyText,
    roundId: payload.roundId || trigger.messageId || session.messageId || '',
    timestamp
  }).catch((error) => {
    (options.logger || console).warn?.(`[workflow.persona-memory] failed to write back memory: ${error.message}`);
    return null;
  });
}

function isSilentWorkflowFailureReason(reason = '') {
  const normalized = String(reason || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.startsWith('provider error:') ||
    normalized.startsWith('provider error text:') ||
    normalized.startsWith('invalid workflow decision:') ||
    normalized.includes('empty direct reply fallback output') ||
    normalized.includes('agent reply fallback failed')
  );
}

function shouldSuppressWorkflowFallback(workflowResult = {}) {
  const workflowDecision = workflowResult?.decision;
  if (workflowDecision?.status !== 'error') {
    return false;
  }

  return isSilentWorkflowFailureReason(workflowDecision.audit?.reason || '');
}

async function handleWorkflowTrigger(workflowRuntime, toolRegistry, outputRuntime, pickFallback, trigger, executionContext, options = {}) {
  const workflowResult = await workflowRuntime.run({
    trigger,
    protocolRequest: options.protocolRequest || {},
    context: executionContext,
    availableTools: Array.isArray(options.availableTools)
      ? options.availableTools
      : toolRegistry.list({ workflowVisibleOnly: true }),
    visibleSkills: Array.isArray(options.visibleSkills) ? options.visibleSkills : []
  });

  const workflowDecision = workflowResult?.decision;
  const hasFinalOutput = Boolean(workflowResult?.outputResult);
  const hasToolOutput = Array.isArray(workflowResult?.outputResults) && workflowResult.outputResults.length > 0;
  const suppressFallback = shouldSuppressWorkflowFallback(workflowResult);

  if (workflowDecision?.status === 'error' || workflowDecision?.status === 'blocked') {
    if (options.sendFallbackOnError === true && !suppressFallback) {
      await sendReplyThroughRuntime(outputRuntime, executionContext, pickFallback());
    }
    return workflowResult;
  }

  if (!hasFinalOutput && !hasToolOutput && options.sendFallbackOnError === true && !suppressFallback) {
    await sendReplyThroughRuntime(outputRuntime, executionContext, pickFallback());
  }

  return workflowResult;
}

function buildExecutionContext(options = {}) {
  const {
    trigger,
    session,
    ctx,
    botProfile,
    contextService
  } = options;
  const template = options.template || null;
  const sourceScope = trigger.isPrivateSession === true ? 'private' : 'public';
  const sourceChannelId = trigger.channelId || session.channelId || session.chatId || '';
  const sourceTriggerKind = trigger.kind || '';

  return {
    session,
    ctx,
    userId: trigger.userId,
    username: trigger.username,
    currentEventId: options.currentEventId || null,
    trigger,
    triggerKind: sourceTriggerKind,
    sourceScope,
    sourceChannelId,
    sourceTriggerKind,
    triggerTemplate: template,
    contextService,
    conversationStore: contextService,
    sendOptions: {
      conversationStore: contextService,
      botProfile,
      sourceScope,
      sourceChannelId,
      sourceTriggerKind,
      triggerKind: sourceTriggerKind,
      ...(options.sendOptions && typeof options.sendOptions === 'object' ? options.sendOptions : {})
    }
  };
}

function resolveConversationContext(options = {}) {
  if (options.conversationContext !== undefined) {
    return options.conversationContext && typeof options.conversationContext === 'object'
      ? { ...options.conversationContext }
      : {};
  }

  if (options.template?.useConversationContext === false) {
    return {};
  }

  const contextService = options.contextService;
  if (!contextService || typeof contextService.buildConversationContextFromTrigger !== 'function') {
    return {};
  }

  return contextService.buildConversationContextFromTrigger(options.trigger, options.currentEventId);
}

function resolveDirectToolCall(options = {}, executionContext = {}) {
  const {
    trigger,
    toolRegistry,
    workflowRuntime,
    outputRuntime,
    pickFallback
  } = options;
  const template = options.template || null;
  const content = typeof trigger?.cleanedContent === 'string' ? trigger.cleanedContent.trim() : '';

  if (!content || template?.allowDirectToolMatch !== true || !toolRegistry) {
    return null;
  }

  const directTool = template?.allowDirectToolMatch === true
    ? toolRegistry.matchMessage(content, {
        includeNames: Array.isArray(template.toolNames) ? template.toolNames : [],
        excludeNames: ['chat', 'reply.current', 'message.route']
      })
    : null;

  if (!directTool) {
    return null;
  }

  return async () => {
    const directAliases = Array.isArray(directTool.metadata?.directAliases)
      ? directTool.metadata.directAliases
      : [];
    const toolResults = await workflowRuntime.executeToolCalls([
      {
        callId: `direct_${directTool.name}_${trigger.messageId || Date.now()}`,
        name: directTool.name,
        arguments: extractKeywordArgs(content, [...directAliases, ...directTool.aliases])
      }
    ], executionContext);

    const outputResults = await workflowRuntime.handleToolResultsOutput(toolResults, executionContext);
    if (toolResults.some(item => item.ok === false) && outputResults.length === 0) {
      await sendReplyThroughRuntime(outputRuntime, executionContext, pickFallback());
    }

    return {
      mode: 'direct-tool',
      tool: directTool.name,
      toolResults,
      outputResults
    };
  };
}

function resolveDirectReplyAgentCall(options = {}, executionContext = {}, chatRequest = null) {
  const {
    trigger,
    directReplyAgent,
    outputRuntime
  } = options;
  const content = typeof trigger?.cleanedContent === 'string' ? trigger.cleanedContent.trim() : '';

  if (!content || !directReplyAgent || typeof directReplyAgent.generateReply !== 'function') {
    return null;
  }

  if (typeof directReplyAgent.shouldHandleRequest === 'function' && !directReplyAgent.shouldHandleRequest(content)) {
    return null;
  }

  return async () => {
    const result = await directReplyAgent.generateReply({
      trigger,
      protocolRequest: chatRequest?.protocolRequest || {},
      context: executionContext,
      availableTools: Array.isArray(options.availableTools) ? options.availableTools : [],
      visibleSkills: Array.isArray(options.visibleSkills) ? options.visibleSkills : []
    });

    if (!result?.ok || !String(result.text || '').trim()) {
      return null;
    }

    await sendReplyThroughRuntime(outputRuntime, executionContext, result.text, {
      renderMode: result.renderMode,
      useMemePipeline: result.renderMode !== 'markdown'
    });

    return {
      mode: 'direct-agent',
      replyText: result.text,
      renderMode: result.renderMode,
      provider: result.provider || ''
    };
  };
}

async function invokeWorkflowChat(options = {}) {
  const {
    trigger,
    session,
    skillManager,
    toolRegistry,
    workflowRuntime,
    outputRuntime,
    pickFallback
  } = options;
  const template = options.template || null;
  const executionContext = buildExecutionContext(options);
  const promptProfileSnapshot = options.promptProfileSnapshot || options.promptProfileService?.resolveProfile?.() || null;
  const directToolCall = resolveDirectToolCall(options, executionContext);

  if (directToolCall) {
    return directToolCall();
  }

  const conversationContext = resolveConversationContext(options);
  const availableTools = Array.isArray(options.availableTools)
    ? options.availableTools
    : toolRegistry.list({ workflowVisibleOnly: true });

  const chatRequest = buildChatProtocolRequest({
    userId: trigger.userId,
    username: trigger.username,
    channelId: trigger.channelId,
    chatId: session.chatId || trigger.channelId,
    messageId: trigger.messageId,
    platform: session.platform || 'iirose',
    content: trigger.cleanedContent,
    isPrivate: trigger.isPrivateSession === true,
      availableSkills: typeof skillManager?.list === 'function'
      ? skillManager.list().map(skill => skill.name)
      : [],
    conversationContext,
    runtimeConfig: options.runtimeConfig || {}
  });

  if (!chatRequest.ok) {
    await sendReplyThroughRuntime(outputRuntime, executionContext, chatRequest.replyText || pickFallback());
    return {
      mode: 'chat-blocked',
      replyText: chatRequest.replyText || pickFallback()
    };
  }

  const directReplyAgentCall = resolveDirectReplyAgentCall(options, executionContext, chatRequest);
  if (directReplyAgentCall) {
    const directReplyResult = await directReplyAgentCall();
    if (directReplyResult) {
      void schedulePersonaMemoryWriteback({
        ...options,
        promptProfileSnapshot
      }, {
        sourceMode: 'direct-agent',
        triggerKind: trigger.kind,
        promptKey: promptProfileSnapshot?.activePrompt || promptProfileSnapshot?.activePromptFile?.key || '',
        promptLabel: promptProfileSnapshot?.styleLabel || promptProfileSnapshot?.activePromptFile?.label || '',
        replyText: directReplyResult.replyText,
        currentMessage: trigger.cleanedContent || trigger.rawContent || '',
        channelId: trigger.channelId || session.channelId || '',
        userId: trigger.userId || session.userId || '',
        username: trigger.username || session.username || '',
        sourceScope: trigger.isPrivateSession === true ? 'private' : 'public',
        timestamp: trigger.timestamp || Date.now(),
        roundId: trigger.messageId || session.messageId || ''
      });
      return directReplyResult;
    }
  }

  const workflowResult = await handleWorkflowTrigger(
    workflowRuntime,
    toolRegistry,
    outputRuntime,
    pickFallback,
    {
      kind: trigger.kind,
      platform: session.platform || 'iirose',
      timestamp: trigger.timestamp,
      session: {
        platform: session.platform || 'iirose',
        channelId: trigger.channelId,
        userId: trigger.userId,
        username: trigger.username,
        messageId: trigger.messageId
      },
      payload: {
        content: trigger.cleanedContent,
        rawContent: trigger.rawContent,
        ...(options.triggerPayload && typeof options.triggerPayload === 'object' ? options.triggerPayload : {})
      }
    },
    executionContext,
    {
      protocolRequest: chatRequest.protocolRequest,
      availableTools,
      visibleSkills: Array.isArray(options.visibleSkills) ? options.visibleSkills : [],
      sendFallbackOnError: template?.sendFallbackOnError !== false
    }
  );

  if (workflowResult?.decision?.status === 'final') {
    const replyText = extractWorkflowReplyText(workflowResult);
    if (replyText) {
      void schedulePersonaMemoryWriteback({
        ...options,
        promptProfileSnapshot
      }, {
        sourceMode: 'workflow-chat',
        triggerKind: trigger.kind,
        promptKey: promptProfileSnapshot?.activePrompt || promptProfileSnapshot?.activePromptFile?.key || '',
        promptLabel: promptProfileSnapshot?.styleLabel || promptProfileSnapshot?.activePromptFile?.label || '',
        replyText,
        currentMessage: trigger.cleanedContent || trigger.rawContent || '',
        channelId: trigger.channelId || session.channelId || '',
        userId: trigger.userId || session.userId || '',
        username: trigger.username || session.username || '',
        sourceScope: trigger.isPrivateSession === true ? 'private' : 'public',
        timestamp: trigger.timestamp || Date.now(),
        roundId: trigger.messageId || session.messageId || ''
      });
    }
  }

  return {
    mode: options.resultMode || 'workflow-chat',
    workflowResult
  };
}

async function handleWorkflowMentionMessage(options = {}) {
  return invokeWorkflowChat(options);
}

async function handleHybridMentionMessage(options = {}) {
  const {
    trigger,
    session,
    ctx,
    botProfile,
    toolRegistry,
    workflowRuntime,
    outputRuntime,
    pickFallback,
    contextService,
    legacyChatHandler
  } = options;
  const executionContext = buildExecutionContext(options);
  const promptProfileSnapshot = options.promptProfileSnapshot || options.promptProfileService?.resolveProfile?.() || null;
  const directToolCall = resolveDirectToolCall(options, executionContext);

  if (directToolCall) {
    return directToolCall();
  }

  if (typeof legacyChatHandler !== 'function') {
    await sendReplyThroughRuntime(outputRuntime, executionContext, pickFallback());
    return {
      mode: 'hybrid-missing-legacy-handler'
    };
  }

  const replyTextRaw = await legacyChatHandler();
  if (typeof replyTextRaw === 'string' && replyTextRaw.trim()) {
    await sendReplyThroughRuntime(outputRuntime, executionContext, replyTextRaw, {
      useMemePipeline: true
    });
    void schedulePersonaMemoryWriteback({
      ...options,
      promptProfileSnapshot
    }, {
      sourceMode: 'hybrid-chat',
      triggerKind: trigger.kind,
      promptKey: promptProfileSnapshot?.activePrompt || promptProfileSnapshot?.activePromptFile?.key || '',
      promptLabel: promptProfileSnapshot?.styleLabel || promptProfileSnapshot?.activePromptFile?.label || '',
      replyText: replyTextRaw,
      currentMessage: trigger.cleanedContent || trigger.rawContent || '',
      channelId: trigger.channelId || session.channelId || '',
      userId: trigger.userId || session.userId || '',
      username: trigger.username || session.username || '',
      sourceScope: trigger.isPrivateSession === true ? 'private' : 'public',
      timestamp: trigger.timestamp || Date.now(),
      roundId: trigger.messageId || session.messageId || ''
    });
    return {
      mode: 'hybrid-chat',
      replyText: replyTextRaw
    };
  }

  await sendReplyThroughRuntime(outputRuntime, executionContext, pickFallback());
  return {
    mode: 'hybrid-fallback'
  };
}

module.exports = {
  extractKeywordArgs,
  isSilentWorkflowFailureReason,
  shouldSuppressWorkflowFallback,
  sendReplyThroughRuntime,
  extractWorkflowReplyText,
  schedulePersonaMemoryWriteback,
  buildExecutionContext,
  resolveConversationContext,
  resolveDirectToolCall,
  resolveDirectReplyAgentCall,
  invokeWorkflowChat,
  handleWorkflowTrigger,
  handleWorkflowMentionMessage,
  handleHybridMentionMessage
};
