/**
 * IIROSE Claw - Main Entry Point
 * Koishi 插件入口
 */

const path = require('path');
const { h } = require('koishi');

// 导入核心模块
const { loadRuntimeConfig, mergeRuntimeConfig } = require('./config/runtime');
const logger = require('./utils/logger');
const { createFallbackPicker } = require('./utils/fallback');
const { ContextService } = require('./runtime/context/service');
const { TriggerRouter } = require('./runtime/trigger/router');
const { TriggerTemplateRegistry } = require('./runtime/trigger/template-registry');
const { ToolRegistry } = require('./tools/registry');
const { PolicyEngine } = require('./runtime/policy/engine');
const { WorkflowRunLog } = require('./runtime/audit/workflow-run-log');
const { OutputRuntime } = require('./runtime/output/runtime');
const { PluginHost } = require('./runtime/plugins/host');
const runtimeGovernancePlugin = require('./runtime/plugins/builtins/runtime-governance');
const defaultTriggerTemplatesPlugin = require('./runtime/plugins/builtins/default-trigger-templates');
const memeOutputPlugin = require('./runtime/plugins/builtins/meme-output');
const legacySkillBridgePlugin = require('./runtime/plugins/builtins/legacy-skill-bridge');
const messagingToolsPlugin = require('./runtime/plugins/builtins/messaging-tools');
const openclawProviderPlugin = require('./runtime/plugins/builtins/openclaw-provider');
const openaiCompatibleProvidersPlugin = require('./runtime/plugins/builtins/openai-compatible-providers');
const workflowPromptProfilePlugin = require('./runtime/plugins/builtins/workflow-prompt-profile');
const workflowPlannersPlugin = require('./runtime/plugins/builtins/workflow-planners');
const legacyOpenClawCompatPlugin = require('./runtime/plugins/builtins/legacy-openclaw-compat');
const helpPlugin = require('./runtime/plugins/builtins/help');
const musicPlugin = require('./runtime/plugins/builtins/music');
const tictactoePlugin = require('./runtime/plugins/games/tictactoe');
const numberGuessPlugin = require('./runtime/plugins/games/number-guess');
const iiroseSystemPlugin = require('./runtime/plugins/iirose/system');
const iiroseUserProfilePlugin = require('./runtime/plugins/iirose/user-profile');
const iiroseRoomPlugin = require('./runtime/plugins/iirose/room');
const iiroseInteractionProbePlugin = require('./runtime/plugins/iirose/interaction-probe');
const proactiveTopicEngagementPlugin = require('./runtime/plugins/proactive/topic-engagement');
const remoteRoomMonitoringPlugin = require('./runtime/plugins/monitoring/remote-room-monitoring');
const { BaseWorkflowPlanner } = require('./runtime/workflow/planners/base-planner');
const { LlmWorkflowPlanner } = require('./runtime/workflow/planners/llm-workflow-planner');
const { WorkflowHookRegistry } = require('./runtime/workflow/hooks/registry');
const { BaseModelProvider } = require('./ai/providers/base-provider');
const { OpenClawAgentBridge, OpenClawProvider } = require('./ai/providers/openclaw-provider');
const { OpenAICompatibleProvider } = require('./ai/providers/openai-compatible-provider');
const { MockProvider } = require('./ai/providers/mock-provider');
const { MemoryStateStore } = require('./runtime/state/memory-store');
const { WorkflowRuntime } = require('./runtime/workflow/runtime');
const {
  sendReplyThroughRuntime,
  handleWorkflowTrigger,
  handleWorkflowMentionMessage,
  handleHybridMentionMessage
} = require('./runtime/message/handler');
const { resolveReplyOutput, inferEmotionFromText } = require('./utils/meme-format');
const { registerImageTagInterceptor, buildImageEmotionTag } = require('./plugins/image-tag-interceptor');

function getOpenClawAdapterClass() {
  return require('./adapters/openclaw-adapter').OpenClawAdapter;
}

function getSkillManagerClass() {
  return require('./skills/manager').SkillManager;
}

function getCreateMessageHandler() {
  return require('./core/message-handler').createMessageHandler;
}

function getLegacyOpenClawPlannerClass() {
  return require('./runtime/workflow/planners/legacy-openclaw-planner').LegacyOpenClawPlanner;
}

function getOpenClawWorkflowOrchestratorClass() {
  return require('./runtime/workflow/orchestrator').OpenClawWorkflowOrchestrator;
}

function normalizeProbability(value, fallback = 0.5) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

function loadConfig() {
  return loadRuntimeConfig();
}

function getWorkflowPlannerName(finalConfig) {
  const planner = finalConfig?.workflow?.planner;
  return typeof planner === 'string' && planner.trim()
    ? planner.trim().toLowerCase()
    : '';
}

function requiresLegacyAdapter(finalConfig) {
  const runtimeMode = finalConfig?.runtime?.mode || 'legacy';
  if (runtimeMode === 'legacy') {
    return true;
  }

  return getWorkflowPlannerName(finalConfig) === 'legacy-openclaw';
}

function requiresLegacySkillManager(finalConfig) {
  const runtimeMode = finalConfig?.runtime?.mode || 'legacy';
  return runtimeMode === 'legacy' || runtimeMode === 'hybrid';
}

function resolveModelProvider(finalConfig, context = {}) {
  const workflowConfig = finalConfig?.workflow || {};
  const directProvider = workflowConfig.provider;

  if (directProvider && typeof directProvider.complete === 'function') {
    return directProvider;
  }

  if (typeof workflowConfig.providerFactory === 'function') {
    const provider = workflowConfig.providerFactory({
      config: finalConfig,
      logger: context.logger || console,
      ctx: context.ctx || null
    });
    if (provider && typeof provider.complete === 'function') {
      return provider;
    }
  }

  const providerName = typeof workflowConfig.provider === 'string' && workflowConfig.provider.trim()
    ? workflowConfig.provider.trim().toLowerCase()
    : (typeof finalConfig?.providers?.default === 'string' && finalConfig.providers.default.trim()
      ? finalConfig.providers.default.trim().toLowerCase()
      : 'openclaw');
  const namedProviders = finalConfig?.providers?.named && typeof finalConfig.providers.named === 'object'
    ? finalConfig.providers.named
    : {};
  const namedProviderConfig = namedProviders[providerName];

  const registeredProvider = context.host?.getProvider?.(providerName);
  if (registeredProvider) {
    if (typeof registeredProvider === 'function') {
      const provider = registeredProvider({
        config: finalConfig,
        logger: context.logger || console,
        ctx: context.ctx || null,
        host: context.host
      });
      if (provider && typeof provider.complete === 'function') {
        return provider;
      }
    } else if (typeof registeredProvider.complete === 'function') {
      return registeredProvider;
    }
  }

  if (providerName === 'mock') {
    return new MockProvider();
  }

  if (namedProviderConfig && typeof namedProviderConfig === 'object' && namedProviderConfig.enabled !== false) {
    return new OpenAICompatibleProvider({
      provider: providerName,
      label: providerName,
      baseUrl: namedProviderConfig.baseUrl,
      apiKey: namedProviderConfig.apiKey,
      model: namedProviderConfig.model,
      endpointPath: namedProviderConfig.endpointPath,
      headers: namedProviderConfig.headers,
      timeout: namedProviderConfig.timeout,
      maxTokens: namedProviderConfig.maxTokens
    });
  }

  if (providerName === 'openclaw' || providerName === 'openclaw-agent' || !providerName) {
    return new OpenClawAgentBridge({
      subagentLabel: finalConfig.openclaw?.subagentLabel || 'iirose-chat',
      timeout: finalConfig.openclaw?.timeout || 30000,
      local: finalConfig.openclaw?.local !== false,
      stateless: finalConfig.openclaw?.stateless !== false,
      logger: context.logger || console
    });
  }

  context.logger?.warn?.(`[workflow] Unknown provider "${providerName}", returning unavailable provider stub.`);
  return {
    label: providerName,
    async complete() {
      return {
        ok: false,
        provider: providerName,
        text: '',
        jsonText: '',
        plainText: '',
        json: null,
        raw: null,
        error: `provider "${providerName}" is not registered`
      };
    }
  };
}

function resolveWorkflowPlanner(finalConfig, context = {}) {
  const workflowConfig = finalConfig?.workflow || {};
  const allowNativeSessionContext = finalConfig.openclaw?.useNativeSessionContext === true
    && context.provider?.supportsStatefulSessions === true;
  const directPlanner = workflowConfig.planner;

  if (directPlanner && typeof directPlanner === 'object' && typeof directPlanner.decideNextStep === 'function') {
    return directPlanner;
  }

  if (typeof workflowConfig.plannerFactory === 'function') {
    const planner = workflowConfig.plannerFactory({
      config: finalConfig,
      adapter: context.adapter || null,
      getLegacyAdapter: typeof context.getLegacyAdapter === 'function' ? context.getLegacyAdapter : (() => context.adapter || null),
      logger: context.logger || console,
      ctx: context.ctx || null
    });
    if (planner && typeof planner.decideNextStep === 'function') {
      return planner;
    }
  }

  const plannerName = typeof workflowConfig.planner === 'string' && workflowConfig.planner.trim()
    ? workflowConfig.planner.trim().toLowerCase()
    : 'legacy-openclaw';

  const registeredPlanner = context.host?.getPlanner?.(plannerName);
  if (registeredPlanner) {
    if (typeof registeredPlanner === 'function') {
      const planner = registeredPlanner({
        config: finalConfig,
        logger: context.logger || console,
        ctx: context.ctx || null,
        host: context.host,
        provider: context.provider || null,
        adapter: context.adapter || null,
        getLegacyAdapter: typeof context.getLegacyAdapter === 'function' ? context.getLegacyAdapter : (() => context.adapter || null)
      });
      if (planner && typeof planner.decideNextStep === 'function') {
        return planner;
      }
    } else if (typeof registeredPlanner.decideNextStep === 'function') {
      return registeredPlanner;
    }
  }

  if (plannerName === 'llm-default' || plannerName === 'llm') {
    return new LlmWorkflowPlanner({
      provider: context.provider || null,
      logger: context.logger || console,
      config: {
        useNativeSessionContext: allowNativeSessionContext,
        meme: finalConfig.meme || {},
        timeoutMs: finalConfig.openclaw?.timeout || 30000,
        promptProfile: finalConfig.workflow?.promptProfile || {},
        promptProfileService: context.host?.getService?.('workflow.prompt-profile') || null
      }
    });
  }

  if (plannerName && plannerName !== 'legacy-openclaw') {
    context.logger?.warn?.(`[workflow] Unknown planner "${plannerName}", fallback to llm-default.`);
    return new LlmWorkflowPlanner({
      provider: context.provider || null,
      logger: context.logger || console,
      config: {
        useNativeSessionContext: allowNativeSessionContext,
        meme: finalConfig.meme || {},
        timeoutMs: finalConfig.openclaw?.timeout || 30000,
        promptProfile: finalConfig.workflow?.promptProfile || {},
        promptProfileService: context.host?.getService?.('workflow.prompt-profile') || null
      }
    });
  }

  return createLegacyOpenClawPlanner(context);
}

function createLegacyOpenClawPlanner(context = {}) {
  const LegacyOpenClawPlanner = getLegacyOpenClawPlannerClass();
  return new LegacyOpenClawPlanner({
    adapter: typeof context.getLegacyAdapter === 'function' ? context.getLegacyAdapter() : (context.adapter || null)
  });
}

function apply(ctx, config = {}) {
  logger.INFO('INIT', 'Starting IIROSE Claw plugin...');
  
  const runtimeConfig = loadRuntimeConfig();
  const finalConfig = mergeRuntimeConfig(runtimeConfig, config);
  const runtimeMode = finalConfig.runtime?.mode || 'legacy';
  const pickFallback = createFallbackPicker(finalConfig.fallbackResponses);
  const memeEnabled = finalConfig.meme?.enabled !== false;
  const memeTriggerProbability = normalizeProbability(finalConfig.meme?.triggerProbability, 0.5);
  const adminUids = Array.isArray(finalConfig.admins) ? [...finalConfig.admins] : [];
  
  logger.INFO('INIT', `Bot name: ${finalConfig.bot.name}`);
  logger.INFO('INIT', `Bot UID: ${finalConfig.bot.uid}`);
  logger.INFO('INIT', `Room ID: ${finalConfig.roomId}`);
  logger.INFO('INIT', `Runtime mode: ${runtimeMode}`);
  
  let modelProvider = null;
  const OpenClawAdapter = getOpenClawAdapterClass();

  let adapter = null;
  let legacyMessageHandler = null;
  const getLegacyAdapter = () => {
    if (!adapter) {
      adapter = new OpenClawAdapter({
        subagentLabel: finalConfig.openclaw?.subagentLabel || 'iirose-chat',
        timeout: finalConfig.openclaw?.timeout || 30000,
        local: finalConfig.openclaw?.local !== false,
        stateless: finalConfig.openclaw?.stateless !== false,
        useNativeSessionContext: finalConfig.openclaw?.useNativeSessionContext === true,
        fallbackResponses: finalConfig.fallbackResponses,
        meme: finalConfig.meme,
        promptProfile: finalConfig.workflow?.promptProfile || {},
        provider: modelProvider
      });
      logger.INFO('INIT', 'OpenClawAdapter initialized');
    }
    return adapter;
  };

  const policyEngine = new PolicyEngine(finalConfig.policy || {});
  const stateStore = new MemoryStateStore();
  const hookRegistry = new WorkflowHookRegistry({ logger });
  const outputRuntime = new OutputRuntime({
    policyEngine,
    sender: async (operation, executionContext = {}) => {
      const targetSession = executionContext.session;
      const senderContext = executionContext.ctx || ctx;
      const mergedSendOptions = {
        ...(executionContext.sendOptions || {}),
        ...(operation.options || {})
      };

      if (!targetSession && operation.kind !== 'message.route') {
        throw new Error('output runtime requires a session');
      }

      if (operation.kind !== 'reply.current' && operation.kind !== 'message.route') {
        throw new Error(`unsupported output operation: ${operation.kind}`);
      }

      if (operation.kind === 'message.route') {
        const bot = targetSession?.bot || senderContext?.bots?.[0];
        const routeChannelId = operation.target?.channelId;

        if (routeChannelId && bot?.sendMessage) {
          return bot.sendMessage(routeChannelId, operation.content?.text || '');
        }
      }

      let outgoingContent = operation.content?.text || '';
      if (
        operation.kind === 'reply.current'
        && targetSession
        && typeof operation.metadata?.quoteMessageId === 'string'
        && operation.metadata.quoteMessageId.trim()
      ) {
        outgoingContent = [
          h.quote(operation.metadata.quoteMessageId.trim()),
          h.text(operation.content?.text || '')
        ];
      }

      return sendToRoom(
        targetSession,
        senderContext,
        outgoingContent,
        {
          ...mergedSendOptions,
          recordText: operation.content?.text || ''
        }
      );
    }
  });
  logger.INFO('INIT', 'OutputRuntime initialized');

  const workflowRunLog = new WorkflowRunLog(finalConfig.workflowRunLog || {});
  logger.INFO('INIT', 'WorkflowRunLog initialized');
  
  const SkillManager = getSkillManagerClass();
  const skillManager = requiresLegacySkillManager(finalConfig)
    ? new SkillManager()
    : null;
  const toolRegistry = new ToolRegistry();
  skillManager?.loadBuiltin?.({ skillManager });
  const contextService = new ContextService(finalConfig.messageMemory || finalConfig.conversationContext || {});
  const triggerTemplateRegistry = new TriggerTemplateRegistry();
  const pluginHost = new PluginHost({
    config: finalConfig,
    logger,
    ctx,
    skillManager,
    toolRegistry,
    outputRuntime,
    policyEngine,
    triggerTemplateRegistry,
    contextService,
    workflowRuntime: null,
    stateStore,
    hookRegistry,
    pickFallback
  });
  pluginHost.registerPlugin(openclawProviderPlugin);
  pluginHost.registerPlugin(openaiCompatibleProvidersPlugin);
  pluginHost.registerPlugin(workflowPromptProfilePlugin);
  pluginHost.registerPlugin(workflowPlannersPlugin);
  if (requiresLegacyAdapter(finalConfig)) {
    pluginHost.registerPlugin(legacyOpenClawCompatPlugin);
  }
  modelProvider = resolveModelProvider(finalConfig, {
    logger,
    ctx,
    host: pluginHost
  });
  const workflowPlanner = resolveWorkflowPlanner(finalConfig, {
    adapter,
    getLegacyAdapter,
    provider: modelProvider,
    logger,
    ctx,
    host: pluginHost
  });
  const workflowOrchestrator = workflowPlanner;
  const workflowRuntime = new WorkflowRuntime({
    planner: workflowPlanner,
    toolRegistry,
    outputRuntime,
    policyEngine,
    stateStore,
    hookRegistry,
    triggerTemplateRegistry,
    runLogger: workflowRunLog,
    logger,
    maxSteps: finalConfig.workflow?.maxSteps || 6,
    maxToolCallsPerStep: finalConfig.workflow?.maxToolCallsPerStep || 4,
    allowParallelReadTools: finalConfig.workflow?.allowParallelReadTools !== false
  });
  pluginHost.setWorkflowRuntime(workflowRuntime);
  pluginHost.registerPlugin(runtimeGovernancePlugin);
  pluginHost.registerPlugin(defaultTriggerTemplatesPlugin);
  pluginHost.registerPlugin(memeOutputPlugin);
  if (skillManager) {
    pluginHost.registerPlugin(legacySkillBridgePlugin);
  }
  pluginHost.registerPlugin(messagingToolsPlugin);
  pluginHost.registerPlugin(helpPlugin);
  pluginHost.registerPlugin(musicPlugin);
  pluginHost.registerPlugin(tictactoePlugin);
  pluginHost.registerPlugin(numberGuessPlugin);
  pluginHost.registerPlugin(iiroseSystemPlugin);
  pluginHost.registerPlugin(iiroseUserProfilePlugin);
  pluginHost.registerPlugin(iiroseRoomPlugin);
  pluginHost.registerPlugin(iiroseInteractionProbePlugin);
  pluginHost.registerPlugin(proactiveTopicEngagementPlugin);
  pluginHost.registerPlugin(remoteRoomMonitoringPlugin);
  logger.INFO('INIT', `Loaded ${skillManager?.list?.().length || 0} built-in skills`);
  logger.INFO('INIT', `Registered ${toolRegistry.list().length} tools`);
  logger.INFO('INIT', `Workflow planner: ${workflowPlanner?.label || workflowPlanner?.constructor?.name || 'anonymous-planner'}`);
  logger.INFO('INIT', 'WorkflowRuntime initialized');
  logger.INFO('INIT', `Registered ${pluginHost.listPlugins().length} runtime plugins`);

  if (runtimeMode !== 'workflow') {
    logger.WARN('INIT', `Runtime mode "${runtimeMode}" is compatibility mode; workflow-first runtime is the primary path.`);
  }
  
  const scriptsDir = path.join(__dirname, 'scripts');
  if (skillManager) {
    Promise.allSettled([
      skillManager.loadScripts(scriptsDir),
      skillManager.loadRemotePlugins(finalConfig.remotePlugins)
    ]).then((results) => {
      if (results[0]?.status === 'fulfilled') {
        logger.INFO('INIT', 'Scripts loaded');
      } else {
        logger.WARN('INIT', 'Failed to load scripts:', results[0]?.reason?.message || 'unknown error');
      }

      if (results[1]?.status === 'fulfilled') {
        logger.INFO('INIT', 'Remote plugins loaded');
      } else {
        logger.WARN('INIT', 'Failed to load remote plugins:', results[1]?.reason?.message || 'unknown error');
      }
    });
  }

  const getLegacyMessageHandler = () => {
    if (!legacyMessageHandler) {
      const createMessageHandler = getCreateMessageHandler();
      legacyMessageHandler = createMessageHandler(finalConfig, getLegacyAdapter(), skillManager, {
        pickFallback,
        getConversationContext({ session, userId, username, cleanedContent }) {
          return contextService.buildContext({
            channelId: session.channelId || session.chatId || '',
            currentEventId: session.conversationEventId,
            userId,
            username,
            currentContent: cleanedContent,
            timestamp: session.conversationTimestamp
          });
        }
      });
      logger.INFO('INIT', 'MessageHandler created');
    }

    return legacyMessageHandler;
  };

  if (requiresLegacyAdapter(finalConfig)) {
    getLegacyMessageHandler();
  }

  registerImageTagInterceptor(ctx, {
    enabled: memeEnabled
  });
  logger.INFO('INIT', 'Image tag interceptor registered');
  
  // 存储全局变量供消息处理使用
  const bot = finalConfig.bot;
  const triggerRouter = new TriggerRouter({
    botProfile: bot,
    adminUids
  });

  if (runtimeMode !== 'legacy' && finalConfig.runtime?.eventTriggersEnabled === true) {
    const eventNames = [
      'iirose/guild-member-switchRoom',
      'iirose/payment',
      'iirose/follower',
      'iirose/broadcast'
    ];

    for (const eventName of eventNames) {
      ctx.on(eventName, async (session, data) => {
        try {
          const trigger = triggerRouter.routePlatformEvent(eventName, session, data);
          const template = triggerTemplateRegistry.get(trigger.kind);
          const executionContext = {
            session,
            ctx,
            userId: trigger.userId,
            username: trigger.username,
            sendOptions: {
              conversationStore: contextService,
              botProfile: bot
            }
          };

          logger.INFO('TRIGGER', `事件触发：${trigger.kind}`);
          await handleWorkflowTrigger(
            workflowRuntime,
            toolRegistry,
            outputRuntime,
            pickFallback,
            trigger,
            executionContext,
            {
              sendFallbackOnError: template.sendFallbackOnError,
              availableTools: triggerTemplateRegistry.resolveTools(toolRegistry, trigger.kind)
            }
          );
        } catch (error) {
          logger.ERROR('TRIGGER', `事件处理失败(${eventName}):`, error.message);
        }
      });
    }
  }
  
  ctx.on('message', async (session) => {
    try {
      const trigger = triggerRouter.routeMessage(session);
      const {
        rawContent: content,
        userId,
        username,
        channelId,
        messageId,
        isPrivateSession,
        isMentioned,
        cleanedContent: cleaned,
        timestamp: messageTimestamp
      } = trigger;

      logger.DEBUG('MSG', `[${username}](${userId}): ${content.substring(0, 100)}`);

      // 私聊硬编码权限：仅允许管理员 UID 触发机器人
      if (trigger.blockedReason === 'private_non_admin') {
        logger.INFO('MSG', `私聊忽略(非管理员): ${username}(${userId})`);
        return;
      }

      const storedMessage = contextService.captureIncomingMessage(trigger);

      if (!isMentioned) return;

      logger.INFO('MSG', `@提及触发：${username}(${userId}): ${content.substring(0, 100)}`);

      if (!cleaned) {
        if (runtimeMode === 'legacy') {
          await sendToRoom(session, ctx, '嗯？你想说什么呀~(◕‿◕✿)', {
            conversationStore: contextService,
            botProfile: bot
          });
        } else {
          await sendReplyThroughRuntime(outputRuntime, {
            session,
            ctx,
            sendOptions: {
              conversationStore: contextService,
              botProfile: bot
            }
          }, '嗯？你想说什么呀~(◕‿◕✿)');
        }
        return;
      }

      if (runtimeMode !== 'legacy') {
        const template = triggerTemplateRegistry.get(trigger.kind);
        const messageResult = runtimeMode === 'hybrid'
          ? await handleHybridMentionMessage({
              trigger,
              session,
              ctx,
              botProfile: bot,
              toolRegistry,
              workflowRuntime,
              outputRuntime,
              pickFallback,
              contextService,
              template,
              legacyChatHandler: async () => getLegacyMessageHandler()({
                sourceSession: session,
                userId,
                username,
                channelId,
                chatId: session.chatId || channelId,
                messageId,
                platform: session.platform || 'iirose',
                content: cleaned,
                message: cleaned,
                rawContent: content,
                cleanedContent: cleaned,
                isBotMentioned: true,
                conversationEventId: storedMessage?.id,
                conversationTimestamp: messageTimestamp
              })
            })
          : await handleWorkflowMentionMessage({
              trigger,
              session,
              ctx,
              botProfile: bot,
              skillManager,
              toolRegistry,
              workflowRuntime,
              outputRuntime,
              pickFallback,
              contextService,
              currentEventId: storedMessage?.id,
              availableTools: triggerTemplateRegistry.resolveTools(toolRegistry, trigger.kind),
              template,
              runtimeConfig: finalConfig
            });

        if (messageResult?.mode === 'direct-tool' && messageResult.tool) {
          logger.INFO('TOOL', `直接工具匹配：${messageResult.tool}`);
        }
        if (messageResult?.mode === 'hybrid-chat') {
          logger.INFO('HYBRID', `Hybrid 聊天：${username}: ${cleaned}`);
        }
        if (messageResult?.mode === 'workflow-chat') {
          logger.INFO('WORKFLOW', `Workflow 聊天：${username}: ${cleaned}`);
        }
        return;
      }

      // 匹配本地技能（非 chat 类）
      const skill = skillManager.find(cleaned);
      if (skill && skill.name !== 'chat') {
        logger.INFO('SKILL', `本地技能匹配：${skill.name}`);
        // 提取关键词后面的参数文本
        let argText = cleaned;
        for (const kw of (skill.keywords || [])) {
          if (cleaned.toLowerCase().startsWith(kw.toLowerCase())) {
            argText = cleaned.substring(kw.length).trim();
            break;
          }
        }
        // 构建 args 对象，同时兼容 handler 中 args.query / args.keyword / 字符串读取
        const args = { query: argText, keyword: argText, song: argText, raw: argText };
        try {
          const result = await skill.handler({ session, args, userId, username });
          logger.INFO('SKILL', `技能返回: ${result?.substring?.(0, 50) || result}`);
          if (result !== null && result !== undefined && result !== '') {
            await sendToRoom(session, ctx, result, {
              conversationStore: contextService,
              botProfile: bot
            });
          }
        } catch (err) {
          logger.ERROR('SKILL', `技能 ${skill.name} 执行失败:`, err.message);
          await sendToRoom(session, ctx, pickFallback(), {
            conversationStore: contextService,
            botProfile: bot
          });
        }
        return;
      }

      // 走 OpenClaw 子代理处理聊天（智能回复）
          logger.INFO('CHAT', `OpenClaw 聊天：${username}: ${cleaned}`);
          try {
        const replyTextRaw = await getLegacyMessageHandler()({
          sourceSession: session,
          userId,
          username,
          channelId,
          chatId: session.chatId || channelId,
          messageId,
          platform: session.platform || 'iirose',
          content: cleaned,
          message: cleaned,
          rawContent: content,
          cleanedContent: cleaned,
          isBotMentioned: true,
          conversationEventId: storedMessage?.id,
          conversationTimestamp: messageTimestamp
        });
        // handleMessage 直接返回纯文本

        const { text: plainReply, emotion: taggedEmotion } = resolveReplyOutput(replyTextRaw);

        if (plainReply && plainReply.trim().length > 0) {
          await sendToRoom(session, ctx, plainReply, {
            conversationStore: contextService,
            botProfile: bot
          });
          let emotionForMeme = taggedEmotion || '';
          let tagMessage = buildImageEmotionTag(emotionForMeme);
          if (!tagMessage) {
            emotionForMeme = inferEmotionFromText(plainReply);
            tagMessage = buildImageEmotionTag(emotionForMeme);
          }

          const shouldSendMeme = memeEnabled && Boolean(tagMessage) && Math.random() < memeTriggerProbability;

          if (shouldSendMeme) {
            logger.INFO('MEME', `触发表情包标记发送: ${emotionForMeme}`);
            await sendToRoom(session, ctx, tagMessage, {
              conversationStore: contextService,
              botProfile: bot,
              recordConversation: false
            });
          }
        } else {
          // OpenClaw 无回复时走统一兜底词条
          await sendToRoom(session, ctx, pickFallback(), {
            conversationStore: contextService,
            botProfile: bot
          });
        }
      } catch (err) {
        logger.ERROR('CHAT', 'OpenClaw 聊天失败:', err.message);
        await sendToRoom(session, ctx, pickFallback(), {
          conversationStore: contextService,
          botProfile: bot
        });
      }

    } catch (error) {
      logger.ERROR('MSG', 'Error handling message:', error.message);
      logger.ERROR('MSG', error.stack);
    }
  });
  
  logger.INFO('INIT', 'IIROSE Claw plugin started successfully');
  
  return {
    skillManager,
    toolRegistry,
    contextService,
    triggerRouter,
    triggerTemplateRegistry,
    pluginHost,
    adapter,
    policyEngine,
    stateStore,
    hookRegistry,
    outputRuntime,
    workflowRunLog,
    modelProvider,
    workflowPlanner,
    workflowOrchestrator,
    workflowRuntime,
    runtimeMode,
    reload() { logger.INFO('RELOAD', 'Reloading plugin...'); },
    getSkills() { return skillManager?.list?.() || []; },
    getTools(options) { return toolRegistry.list(options); },
    executeSkill(name, args, session) { return skillManager?.execute?.(name, args, session) ?? null; },
    executeTool(name, context, input) { return toolRegistry.execute(name, context, input); }
  };
}

/**
 * 发送消息到房间 - 兼容多种方式
 */
function shouldRecordBotMessage(output, options = {}) {
  if (options.recordConversation === false) return false;
  if (typeof output !== 'string' || !output.trim()) return false;
  if (/\$image\s*[=＝]\s*[^\r\n$]{1,24}\$/i.test(output)) return false;
  if (/^\[(https?:\/\/[^\]\s]+)#e\]$/i.test(output.trim())) return false;
  return true;
}

function recordBotMessage(session, output, options = {}, result) {
  const conversationStore = options.conversationStore;
  if (!conversationStore || !shouldRecordBotMessage(output, options)) return;

  const messageId = Array.isArray(result) && result.length > 0 ? String(result[0]) : '';
  conversationStore.addBotMessage({
    channelId: session.channelId || session.guildId || '',
    messageId,
    userId: options.botProfile?.uid || 'bot',
    username: options.botProfile?.name || 'Bot',
    content: output,
    timestamp: Date.now()
  });
}

async function sendToRoom(session, ctx, message, options = {}) {
  const rawOutput = message;
  const preview = typeof rawOutput === 'string' ? rawOutput : String(rawOutput ?? '');
  logger.INFO('SEND', `准备发送: ${preview.substring(0, 50)}...`);
  
  try {
    // 方式1: session.send()
    const result = await session.send(rawOutput);
    logger.INFO('SEND', 'session.send 成功:', result);
    recordBotMessage(session, options.recordText || preview, options, result);
    return result;
  } catch (err1) {
    logger.WARN('SEND', 'session.send 失败:', err1.message);
    
    try {
      // 方式2: session.execute()
      await session.execute(rawOutput);
      logger.INFO('SEND', 'session.execute 成功');
      recordBotMessage(session, options.recordText || preview, options);
      return;
    } catch (err2) {
      logger.WARN('SEND', 'session.execute 失败:', err2.message);
      
      try {
        // 方式3: bot.sendMessage()
        const bot = session.bot || ctx.bots?.[0];
        if (bot && bot.sendMessage) {
          const channelId = session.channelId || session.guildId;
          const result = await bot.sendMessage(channelId, rawOutput);
          logger.INFO('SEND', 'bot.sendMessage 成功');
          recordBotMessage(session, options.recordText || preview, options, result);
          return;
        }
      } catch (err3) {
        logger.ERROR('SEND', 'bot.sendMessage 失败:', err3.message);
      }
      
      logger.ERROR('SEND', '所有发送方式都失败了');
    }
  }
}

const exported = {
  name: 'iirose-claw',
  apply,
  ToolRegistry,
  loadConfig,
  loadRuntimeConfig,
  mergeRuntimeConfig,
  PolicyEngine,
  OutputRuntime,
  BaseModelProvider,
  OpenClawAgentBridge,
  OpenClawProvider,
  OpenAICompatibleProvider,
  MockProvider,
  MemoryStateStore,
  BaseWorkflowPlanner,
  LlmWorkflowPlanner,
  WorkflowHookRegistry,
  WorkflowRuntime,
  ContextService,
  TriggerRouter,
  WorkflowRunLog,
  TriggerTemplateRegistry,
  PluginHost,
  resolveModelProvider,
  resolveWorkflowPlanner
};

Object.defineProperty(exported, 'OpenClawAdapter', {
  enumerable: true,
  get() {
    return getOpenClawAdapterClass();
  }
});

Object.defineProperty(exported, 'SkillManager', {
  enumerable: true,
  get() {
    return getSkillManagerClass();
  }
});

Object.defineProperty(exported, 'createMessageHandler', {
  enumerable: true,
  get() {
    return getCreateMessageHandler();
  }
});

Object.defineProperty(exported, 'LegacyOpenClawPlanner', {
  enumerable: true,
  get() {
    return getLegacyOpenClawPlannerClass();
  }
});

Object.defineProperty(exported, 'OpenClawWorkflowOrchestrator', {
  enumerable: true,
  get() {
    return getOpenClawWorkflowOrchestratorClass();
  }
});

module.exports = exported;
