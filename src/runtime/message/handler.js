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
      useMemePipeline: options.useMemePipeline === true
    },
    options: {
      recordConversation: options.recordConversation !== false
    }
  }, executionContext);
}

async function handleWorkflowTrigger(workflowRuntime, toolRegistry, outputRuntime, pickFallback, trigger, executionContext, options = {}) {
  const workflowResult = await workflowRuntime.run({
    trigger,
    protocolRequest: options.protocolRequest || {},
    context: executionContext,
    availableTools: Array.isArray(options.availableTools)
      ? options.availableTools
      : toolRegistry.list({ workflowVisibleOnly: true })
  });

  const workflowDecision = workflowResult?.decision;
  const hasFinalOutput = Boolean(workflowResult?.outputResult);
  const hasToolOutput = Array.isArray(workflowResult?.outputResults) && workflowResult.outputResults.length > 0;

  if (workflowDecision?.status === 'error' || workflowDecision?.status === 'blocked') {
    if (options.sendFallbackOnError === true) {
      await sendReplyThroughRuntime(outputRuntime, executionContext, pickFallback());
    }
    return workflowResult;
  }

  if (!hasFinalOutput && !hasToolOutput && options.sendFallbackOnError === true) {
    await sendReplyThroughRuntime(outputRuntime, executionContext, pickFallback());
  }

  return workflowResult;
}

async function handleWorkflowMentionMessage(options = {}) {
  const {
    trigger,
    session,
    ctx,
    botProfile,
    skillManager,
    toolRegistry,
    workflowRuntime,
    outputRuntime,
    pickFallback,
    contextService
  } = options;
  const template = options.template || null;

  const executionContext = {
    session,
    ctx,
    userId: trigger.userId,
    username: trigger.username,
    triggerTemplate: template,
    contextService,
    conversationStore: contextService,
    sendOptions: {
      conversationStore: contextService,
      botProfile
    }
  };

  const directTool = template?.allowDirectToolMatch === true
    ? toolRegistry.matchMessage(trigger.cleanedContent, {
        includeNames: Array.isArray(template.toolNames) ? template.toolNames : [],
        excludeNames: ['chat', 'reply.current', 'message.route']
      })
    : null;

  if (directTool) {
    const directAliases = Array.isArray(directTool.metadata?.directAliases)
      ? directTool.metadata.directAliases
      : [];
    const toolResults = await workflowRuntime.executeToolCalls([
      {
        callId: `direct_${directTool.name}_${trigger.messageId || Date.now()}`,
        name: directTool.name,
        arguments: extractKeywordArgs(trigger.cleanedContent, [...directAliases, ...directTool.aliases])
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
  }

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
    conversationContext: contextService.buildConversationContextFromTrigger(trigger, options.currentEventId),
    runtimeConfig: options.runtimeConfig || {}
  });

  if (!chatRequest.ok) {
    await sendReplyThroughRuntime(outputRuntime, executionContext, chatRequest.replyText || pickFallback());
    return {
      mode: 'chat-blocked',
      replyText: chatRequest.replyText || pickFallback()
    };
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
        rawContent: trigger.rawContent
      }
    },
    executionContext,
    {
      protocolRequest: chatRequest.protocolRequest,
      availableTools: Array.isArray(options.availableTools)
        ? options.availableTools
        : toolRegistry.list({ workflowVisibleOnly: true }),
      sendFallbackOnError: template?.sendFallbackOnError !== false
    }
  );

  return {
    mode: 'workflow-chat',
    workflowResult
  };
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
  const template = options.template || null;

  const executionContext = {
    session,
    ctx,
    userId: trigger.userId,
    username: trigger.username,
    triggerTemplate: template,
    contextService,
    conversationStore: contextService,
    sendOptions: {
      conversationStore: contextService,
      botProfile
    }
  };

  const directTool = template?.allowDirectToolMatch === true
    ? toolRegistry.matchMessage(trigger.cleanedContent, {
        includeNames: Array.isArray(template.toolNames) ? template.toolNames : [],
        excludeNames: ['chat', 'reply.current', 'message.route']
      })
    : null;

  if (directTool) {
    const directAliases = Array.isArray(directTool.metadata?.directAliases)
      ? directTool.metadata.directAliases
      : [];
    const toolResults = await workflowRuntime.executeToolCalls([
      {
        callId: `direct_${directTool.name}_${trigger.messageId || Date.now()}`,
        name: directTool.name,
        arguments: extractKeywordArgs(trigger.cleanedContent, [...directAliases, ...directTool.aliases])
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
  sendReplyThroughRuntime,
  handleWorkflowTrigger,
  handleWorkflowMentionMessage,
  handleHybridMentionMessage
};
