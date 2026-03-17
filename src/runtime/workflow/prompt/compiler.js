/**
 * Workflow prompt compiler
 * 统一构造 workflow planner 使用的 prompt/messages。
 */

const { buildContextPrompt } = require('./serializers');

const DEFAULT_PROMPT_PROFILE = {
  activeStyle: 'plain',
  botProfile: {
    name: 'IIROSE Claw',
    identity: '你是一个在 IIROSE 房间中协助聊天与工具编排的机器人助手。',
    extraInstruction: ''
  },
  styles: {
    plain: {
      label: '平淡',
      instruction: '语气自然、克制、直接，不刻意卖萌，不夸张，不撒娇。'
    }
  }
};

function normalizeText(value, max = 300) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  return text.length > max ? text.slice(0, max) : text;
}

function resolvePromptProfileFromConfig(promptProfileConfig = {}) {
  const config = promptProfileConfig && typeof promptProfileConfig === 'object'
    ? promptProfileConfig
    : {};
  const styles = config.styles && typeof config.styles === 'object' ? config.styles : DEFAULT_PROMPT_PROFILE.styles;
  const activeStyle = normalizeText(config.activeStyle, 64).toLowerCase() || DEFAULT_PROMPT_PROFILE.activeStyle;
  const style = styles[activeStyle] && typeof styles[activeStyle] === 'object'
    ? styles[activeStyle]
    : styles[DEFAULT_PROMPT_PROFILE.activeStyle];
  const botProfile = config.botProfile && typeof config.botProfile === 'object'
    ? config.botProfile
    : DEFAULT_PROMPT_PROFILE.botProfile;

  return {
    activeStyle,
    styleLabel: normalizeText(style?.label, 80) || activeStyle,
    styleInstruction: normalizeText(style?.instruction, 400),
    botName: normalizeText(botProfile?.name, 80),
    botIdentity: normalizeText(botProfile?.identity, 400),
    botExtraInstruction: normalizeText(botProfile?.extraInstruction, 400)
  };
}

function resolvePromptProfile(workflowInput = {}, options = {}) {
  const promptProfileService = options.promptProfileService || workflowInput.context?.promptProfileService || null;
  if (promptProfileService && typeof promptProfileService.resolveProfile === 'function') {
    const resolved = promptProfileService.resolveProfile();
    if (resolved && typeof resolved === 'object') {
      return {
        activeStyle: normalizeText(resolved.activeStyle, 64).toLowerCase() || DEFAULT_PROMPT_PROFILE.activeStyle,
        styleLabel: normalizeText(resolved.styleLabel, 80),
        styleInstruction: normalizeText(resolved.styleInstruction, 400),
        botName: normalizeText(resolved.botProfile?.name, 80),
        botIdentity: normalizeText(resolved.botProfile?.identity, 400),
        botExtraInstruction: normalizeText(resolved.botProfile?.extraInstruction, 400)
      };
    }
  }

  return resolvePromptProfileFromConfig(options.promptProfile || workflowInput.context?.promptProfile || {});
}

function compileWorkflowPrompt(workflowInput = {}, options = {}) {
  const protocolRequest = workflowInput.protocolRequest || {};
  const availableTools = Array.isArray(workflowInput.availableTools) ? workflowInput.availableTools : [];
  const workflow = workflowInput.workflow || {};
  const toolHistory = Array.isArray(workflow.toolHistory) ? workflow.toolHistory : [];
  const trigger = workflowInput.trigger || {};
  const triggerTemplate = workflowInput.context?.triggerTemplate
    && typeof workflowInput.context.triggerTemplate === 'object'
    ? workflowInput.context.triggerTemplate
    : {};
  const contextPrompt = typeof options.contextPrompt === 'string' && options.contextPrompt.trim()
    ? options.contextPrompt.trim()
    : buildContextPrompt(protocolRequest, {
        useNativeSessionContext: options.useNativeSessionContext === true
      });
  const meme = options.meme && typeof options.meme === 'object' ? options.meme : {};
  const promptProfile = resolvePromptProfile(workflowInput, options);

  const lines = [
    contextPrompt,
    '',
    '机器人设定:',
    `- 名称: ${promptProfile.botName || DEFAULT_PROMPT_PROFILE.botProfile.name}`,
    `- 身份: ${promptProfile.botIdentity || DEFAULT_PROMPT_PROFILE.botProfile.identity}`,
    `- 当前回复风格: ${promptProfile.styleLabel || promptProfile.activeStyle || DEFAULT_PROMPT_PROFILE.activeStyle}`,
    `- 风格要求: ${promptProfile.styleInstruction || DEFAULT_PROMPT_PROFILE.styles.plain.instruction}`
  ];

  if (promptProfile.botExtraInstruction) {
    lines.push(`- 额外要求: ${promptProfile.botExtraInstruction}`);
  }

  lines.push(
    '',
    '你现在工作在一个多步 workflow 运行时中。',
    '你的任务不是直接自由回答，而是根据当前消息、可用工具和已有执行结果，决定下一步。',
    '你必须只输出 JSON，不要输出 markdown 代码块，不要输出额外解释。',
    '',
    '🔄 多步规划能力:',
    '- 你可以连续规划多步工具调用。每次你返回 needs_tools 后，工具会执行并返回结果，然后你会再次被调用。',
    '- 如果用户指令包含多个动作（如"去 A 房间然后回来"），请分步规划：',
    '  Step 1: needs_tools → iirose.room.move({roomId: "A"})',
    '  Step 2: 等待工具执行结果（你会再次被调用，看到 toolHistory 中有执行结果）',
    '  Step 3: needs_tools → iirose.room.move({roomId: "原房间 ID"})',
    '  Step 4: final → 确认完成',
    '- 每次只规划当前这一步，不要试图在一步中调用多个工具。',
    '- 对于管理员说的“转移到/移动到/移步到/去某房间/把 bot 挪到某房间”等自然语言房间迁移意图，应优先考虑 iirose.room.move。',
    '- 如果用户消息里包含 <sharp id="房间ID"/> 或明显的房间 ID，应把它解析为 iirose.room.move 的 roomId 参数，而不是把它当普通聊天。',
    '',
    '房间迁移示例:',
    '- 用户: "转移到 <sharp id=\\"68807acf5884c\\"/>"',
    '  → {"status":"needs_tools","toolCalls":[{"callId":"call_room_move_1","name":"iirose.room.move","arguments":{"roomId":"68807acf5884c"}}]}',
    '- 用户: "移动到 68807acf5884c 房间"',
    '  → {"status":"needs_tools","toolCalls":[{"callId":"call_room_move_1","name":"iirose.room.move","arguments":{"roomId":"68807acf5884c"}}]}',
    '- 用户: "去这个房间 <sharp id=\\"68807acf5884c\\"/>"',
    '  → {"status":"needs_tools","toolCalls":[{"callId":"call_room_move_1","name":"iirose.room.move","arguments":{"roomId":"68807acf5884c"}}]}',
    '',
    '输出格式必须是以下之一:',
    '1) 需要调用工具:',
    '{"status":"needs_tools","decisionSummary":"简短说明","toolCalls":[{"callId":"call_xxx","name":"tool.name","arguments":{}}],"finalOutput":{"mode":"reply","text":"","replySegments":[],"operations":[]},"audit":{"reason":"","blocked":false}}',
    '2) 直接结束并回复:',
    '{"status":"final","decisionSummary":"简短说明","toolCalls":[],"finalOutput":{"mode":"reply","text":"回复内容","replySegments":[],"operations":[]},"audit":{"reason":"","blocked":false}}',
    '  - 若需要编排多条输出，可在 finalOutput.operations 中给出 operation 数组（每个元素形如 {"kind":"reply.current","content":{"text":"...","useMemePipeline":true}}）。',
    '3) 阻止执行:',
    '{"status":"blocked","decisionSummary":"简短说明","toolCalls":[],"finalOutput":{"mode":"none","text":"","replySegments":[],"operations":[]},"audit":{"reason":"阻止原因","blocked":true}}'
  );

  if (trigger.kind) {
    lines.push('', `当前 trigger: ${trigger.kind}`);
  }

  if (typeof triggerTemplate.instruction === 'string' && triggerTemplate.instruction.trim()) {
    lines.push('', `trigger instruction: ${triggerTemplate.instruction.trim()}`);
  }

  const permission = protocolRequest?.permission || {};
  lines.push(
    `权限摘要: isAdmin=${permission.isAdmin === true}; isSystemRequest=${permission.isSystemRequest === true}`
  );

  if (trigger.payload && typeof trigger.payload === 'object' && Object.keys(trigger.payload).length > 0) {
    const serializedPayload = JSON.stringify(trigger.payload).slice(0, 1200);
    lines.push(`trigger payload: ${serializedPayload}`);
  }

  if (trigger.eventData && typeof trigger.eventData === 'object' && Object.keys(trigger.eventData).length > 0) {
    const serializedEventData = JSON.stringify(trigger.eventData).slice(0, 1200);
    lines.push(`trigger event data: ${serializedEventData}`);
  }

  if (availableTools.length > 0) {
    lines.push('', '可用工具列表:');
    for (const tool of availableTools) {
      const scopes = Array.isArray(tool.scopes) && tool.scopes.length > 0 ? tool.scopes.join(', ') : 'none';
      const permissionList = Array.isArray(tool.permission) && tool.permission.length > 0 ? tool.permission.join(', ') : 'none';
      lines.push(`- ${tool.name}: ${tool.description || 'no description'} | risk=${tool.riskLevel || 'medium'} | sideEffect=${tool.sideEffect === true} | scopes=${scopes} | permission=${permissionList}`);
    }
  }

  if (toolHistory.length > 0) {
    lines.push('', '已执行工具结果:');
    for (const item of toolHistory) {
      lines.push(`- ${item.name || 'unknown'} | ok=${item.ok !== false} | summary=${item.summary || item.error || ''}`);
    }
  }

  if (meme.enabled !== false && meme.requestEmotionTag !== false) {
    lines.push('', '如果 finalOutput.mode=reply，且适合表情包增强，可在 finalOutput.text 末尾附加 [[EMO:情绪]]。');
  }

  const prompt = lines.join('\n');
  return {
    systemPrompt: '',
    userPrompt: prompt,
    prompt,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    responseFormat: {
      type: 'json_object',
      name: 'WorkflowStepDecision'
    }
  };
}

module.exports = {
  compileWorkflowPrompt
};
