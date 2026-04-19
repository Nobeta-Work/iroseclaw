/**
 * Workflow prompt compiler
 * 统一构造 workflow planner 使用的 prompt/messages。
 */

const { buildContextPrompt } = require('./serializers');
const { createPromptProfileSnapshot } = require('./profile-service');

const DEFAULT_PROMPT_PROFILE = {
  mode: 'legacy',
  activeStyle: 'plain',
  activePrompt: '',
  botProfile: {
    name: 'IIROSE Claw',
    identity: '你是一个在 IIROSE 房间中协助聊天与工具编排的机器人助手。',
    extraInstruction: ''
  },
  globalPrompt: null,
  activePromptFile: null,
  availablePromptFiles: [],
  promptFiles: [],
  memoryText: '',
  memoryEntries: [],
  promptText: '',
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

function normalizePromptFileMeta(file) {
  if (!file || typeof file !== 'object') return null;
  return {
    key: normalizeText(file.key, 120),
    label: normalizeText(file.label, 120),
    fileName: normalizeText(file.fileName, 160),
    path: typeof file.path === 'string' ? file.path : '',
    isGlobal: file.isGlobal === true
  };
}

function normalizePromptProfileSnapshot(profile = {}) {
  const input = profile && typeof profile === 'object' ? profile : {};
  const botProfile = input.botProfile && typeof input.botProfile === 'object'
    ? input.botProfile
    : {};
  const styles = input.styles && typeof input.styles === 'object' ? input.styles : DEFAULT_PROMPT_PROFILE.styles;

  return {
    mode: normalizeText(input.mode, 32) || DEFAULT_PROMPT_PROFILE.mode,
    activeStyle: normalizeText(input.activeStyle, 64).toLowerCase() || DEFAULT_PROMPT_PROFILE.activeStyle,
    activePrompt: normalizeText(input.activePrompt, 120),
    styleLabel: normalizeText(input.styleLabel, 120) || DEFAULT_PROMPT_PROFILE.styles.plain.label,
    styleInstruction: normalizeText(input.styleInstruction, 500),
    botProfile: {
      name: normalizeText(botProfile.name, 80) || DEFAULT_PROMPT_PROFILE.botProfile.name,
      identity: normalizeText(botProfile.identity, 500) || DEFAULT_PROMPT_PROFILE.botProfile.identity,
      extraInstruction: normalizeText(botProfile.extraInstruction, 500)
    },
    promptDir: typeof input.promptDir === 'string' ? input.promptDir : '',
    globalPrompt: normalizePromptFileMeta(input.globalPrompt),
    activePromptFile: normalizePromptFileMeta(input.activePromptFile),
    availablePromptFiles: Array.isArray(input.availablePromptFiles)
      ? input.availablePromptFiles.map(normalizePromptFileMeta).filter(Boolean)
      : [],
    promptFiles: Array.isArray(input.promptFiles)
      ? input.promptFiles.map(normalizePromptFileMeta).filter(Boolean)
      : [],
    memoryText: typeof input.memoryText === 'string' ? input.memoryText.trim() : '',
    memoryEntries: Array.isArray(input.memoryEntries) ? input.memoryEntries : [],
    promptText: typeof input.promptText === 'string' ? input.promptText.trim() : '',
    styles
  };
}

function resolvePromptProfileFromConfig(promptProfileConfig = {}) {
  return normalizePromptProfileSnapshot(createPromptProfileSnapshot(promptProfileConfig || {}, {}));
}

function resolvePromptProfile(workflowInput = {}, options = {}) {
  const promptProfileService = options.promptProfileService || workflowInput.context?.promptProfileService || null;
  if (promptProfileService && typeof promptProfileService.resolveProfile === 'function') {
    const resolved = normalizePromptProfileSnapshot(promptProfileService.resolveProfile());
    if (resolved && typeof resolved === 'object') {
      return resolved;
    }
  }

  return resolvePromptProfileFromConfig(options.promptProfile || workflowInput.context?.promptProfile || {});
}

function buildPromptProfileLines(promptProfile = {}) {
  const profile = normalizePromptProfileSnapshot(promptProfile);
  if (profile.mode === 'file' && profile.promptText) {
    const promptLabels = profile.promptFiles.length > 0
      ? profile.promptFiles.map(file => file.isGlobal ? `${file.label}(全局前置)` : file.label).join(' / ')
      : '无';
    const lines = [
      '当前对话提示词配置:',
      '- 模式: 文件读取',
      `- 当前常态 prompt: ${profile.styleLabel || profile.activePrompt || '未设置'}`,
      `- 全局前置 prompt: ${profile.globalPrompt?.label || '未配置'}`,
      `- prompt 文件列表: ${promptLabels}`,
      ''
    ];

    if (profile.botProfile.name) {
      lines.push(`运行时机器人名: ${profile.botProfile.name}`);
    }

    lines.push(
      '以下是当前生效的对话提示词文件原文，请严格遵循：',
      '<<<IIC_PROMPT_FILES',
      profile.promptText,
      'IIC_PROMPT_FILES>>>'
    );

    if (profile.botProfile.extraInstruction) {
      lines.push(`额外要求: ${profile.botProfile.extraInstruction}`);
    }

    return lines;
  }

  const lines = [
    '机器人设定:',
    `- 名称: ${profile.botProfile.name || DEFAULT_PROMPT_PROFILE.botProfile.name}`,
    `- 身份: ${profile.botProfile.identity || DEFAULT_PROMPT_PROFILE.botProfile.identity}`,
    `- 当前回复风格: ${profile.styleLabel || profile.activeStyle || DEFAULT_PROMPT_PROFILE.activeStyle}`,
    `- 风格要求: ${profile.styleInstruction || DEFAULT_PROMPT_PROFILE.styles.plain.instruction}`
  ];

  if (profile.botProfile.extraInstruction) {
    lines.push(`- 额外要求: ${profile.botProfile.extraInstruction}`);
  }

  return lines;
}

function compileWorkflowPrompt(workflowInput = {}, options = {}) {
  const protocolRequest = workflowInput.protocolRequest || {};
  const availableTools = Array.isArray(workflowInput.availableTools) ? workflowInput.availableTools : [];
  const visibleSkills = Array.isArray(workflowInput.visibleSkills) ? workflowInput.visibleSkills : [];
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
    ''
  ];

  lines.push(...buildPromptProfileLines(promptProfile));

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
    '- 如果用户是在索要代码、代码块、markdown 示例、文案、解释或普通聊天回复，不要为了凑工具而调用 iirose.room.move 等房间类工具。',
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
    '{"status":"needs_tools","decisionSummary":"简短说明","toolCalls":[{"callId":"call_xxx","name":"tool.name","arguments":{}}],"finalOutput":{"mode":"reply","text":"","renderMode":"plain","replySegments":[],"operations":[]},"audit":{"reason":"","blocked":false}}',
    '2) 直接结束并回复:',
    '{"status":"final","decisionSummary":"简短说明","toolCalls":[],"finalOutput":{"mode":"reply","text":"回复内容","renderMode":"plain","replySegments":[],"operations":[]},"audit":{"reason":"","blocked":false}}',
    '  - finalOutput.renderMode 仅可取 plain 或 markdown。普通聊天默认 plain；当回复需要代码块、标题、引用、结构化列表等 markdown 格式时使用 markdown。',
    '  - 当 renderMode=markdown 时，不要手写 IIROSE 的渲染前缀 \\\\\\*，运行时会自动注入。',
    '  - 若需要编排多条输出，可在 finalOutput.operations 中给出 operation 数组（每个元素形如 {"kind":"reply.current","content":{"text":"...","renderMode":"markdown","useMemePipeline":false}}）。',
    '  - operation.kind 可选值:',
    '    * reply.current: 回复当前会话（默认值，普通聊天场景优先使用）',
    '    * message.route: 路由消息到其他房间或私聊频道，需额外指定 content.targetChannelId（管理员可用）',
    '    * communication.private.send: 向指定用户发送私聊消息，需在 toolCalls 中调用对应工具（管理员可用）',
    '  - 若无需发送任何消息，可设置 finalOutput.mode="none"，无需回复内容。',
    '  - 管理员场景下可根据需求灵活选择发送方式：例如用户在私聊要求发公屏通知时可使用 message.route，公屏用户要求单独回复隐私内容时可使用 communication.private.send。',
    '3) 阻止执行:',
    '{"status":"blocked","decisionSummary":"简短说明","toolCalls":[],"finalOutput":{"mode":"none","text":"","renderMode":"plain","replySegments":[],"operations":[]},"audit":{"reason":"阻止原因","blocked":true}}'
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

  if (visibleSkills.length > 0) {
    lines.push('', '可用 Skills:');
    for (const skill of visibleSkills) {
      const toolNames = Array.isArray(skill.toolNames) && skill.toolNames.length > 0
        ? skill.toolNames.join(', ')
        : 'none';
      const tags = Array.isArray(skill.tags) && skill.tags.length > 0
        ? ` | tags=${skill.tags.join(', ')}`
        : '';
      lines.push(`- ${skill.id}: ${skill.summary || skill.name || 'no summary'} | adminOnly=${skill.adminOnly === true}${tags}`);
      lines.push(`  tools: ${toolNames}`);
      if (Array.isArray(skill.examples) && skill.examples.length > 0) {
        lines.push(`  examples: ${skill.examples.join(' ; ')}`);
      }
    }
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
  buildPromptProfileLines,
  resolvePromptProfile,
  compileWorkflowPrompt
};
