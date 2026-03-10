/**
 * IIROSE Claw - Main Entry Point
 * Koishi 插件入口
 */

const path = require('path');

// 导入核心模块
const { OpenClawAdapter } = require('./adapters/openclaw-adapter');
const { SkillManager } = require('./skills/manager');
const { createMessageHandler } = require('./core/message-handler');
const { loadRuntimeConfig, mergeRuntimeConfig } = require('./config/runtime');
const logger = require('./utils/logger');

function loadConfig() {
  return loadRuntimeConfig();
}

function apply(ctx, config = {}) {
  logger.INFO('INIT', 'Starting IIROSE Claw plugin...');
  
  const runtimeConfig = loadRuntimeConfig();
  const finalConfig = mergeRuntimeConfig(runtimeConfig, config);
  
  logger.INFO('INIT', `Bot name: ${finalConfig.bot.name}`);
  logger.INFO('INIT', `Bot UID: ${finalConfig.bot.uid}`);
  logger.INFO('INIT', `Room ID: ${finalConfig.roomId}`);
  
  const adapter = new OpenClawAdapter({
    subagentLabel: finalConfig.openclaw?.subagentLabel || 'iirose-chat',
    timeout: finalConfig.openclaw?.timeout || 30000,
    fallbackResponses: finalConfig.fallbackResponses
  });
  
  logger.INFO('INIT', 'OpenClawAdapter initialized');
  
  const skillManager = new SkillManager();
  skillManager.loadBuiltin({ skillManager });
  logger.INFO('INIT', `Loaded ${skillManager.list().length} built-in skills`);
  
  const scriptsDir = path.join(__dirname, 'scripts');
  skillManager.loadScripts(scriptsDir).then(() => {
    logger.INFO('INIT', 'Scripts loaded');
  }).catch(err => {
    logger.WARN('INIT', 'Failed to load scripts:', err.message);
  });
  
  const handleMessage = createMessageHandler(finalConfig, adapter, skillManager);
  logger.INFO('INIT', 'MessageHandler created');
  
  // 存储全局变量供消息处理使用
  const bot = finalConfig.bot;
  
  ctx.on('message', async (session) => {
    try {
      const content = session.content || '';
      const userId = session.userId || '';
      const username = session.username || session.author?.name || '';
      const botUid = bot?.uid || '';
      const botName = bot?.name || '';

      logger.DEBUG('MSG', `[${username}](${userId}): ${content.substring(0, 100)}`);

      let isMentioned = false;
      if (session.parsed?.appel) isMentioned = true;
      if (botUid && content.includes(`id="${botUid}"`)) isMentioned = true;
      if (botUid && content.includes(`<at id="${botUid}"`)) isMentioned = true;
      if (botName && new RegExp(`@${botName}`, 'i').test(content)) isMentioned = true;
      if (botName && content.trim().startsWith(botName)) isMentioned = true;

      if (!isMentioned) return;

      logger.INFO('MSG', `@提及触发：${username}(${userId}): ${content.substring(0, 100)}`);

      let cleaned = content;
      cleaned = cleaned.replace(/<at[^>]*\/>/gi, '');
      cleaned = cleaned.replace(/<at[^>]*>.*?<\/at>/gi, '');
      cleaned = cleaned.replace(new RegExp(`@${botName}\\s*`, 'gi'), '');
      cleaned = cleaned.trim();

      if (!cleaned) {
        await sendToRoom(session, ctx, '嗯？你想说什么呀~(◕‿◕✿)');
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
            await sendToRoom(session, ctx, result);
          }
        } catch (err) {
          logger.ERROR('SKILL', `技能 ${skill.name} 执行失败:`, err.message);
          await sendToRoom(session, ctx, '哎呀出错了~稍后再试试吧 (◕‿◕✿)');
        }
        return;
      }

      // 走 OpenClaw 子代理处理聊天（智能回复）
      logger.INFO('CHAT', `OpenClaw 聊天：${username}: ${cleaned}`);
      try {
        const replyText = await handleMessage({
          ...session,
          content: cleaned,
          message: cleaned,
          rawContent: content,
          cleanedContent: cleaned,
          isBotMentioned: true
        });
        // handleMessage 直接返回纯文本
        
        if (replyText && replyText.trim().length > 0) {
          await sendToRoom(session, ctx, replyText);
        } else {
          // OpenClaw 无回复时的兜底
          await sendToRoom(session, ctx, '嗯嗯~(◕‿◕✿)');
        }
      } catch (err) {
        logger.ERROR('CHAT', 'OpenClaw 聊天失败:', err.message);
        // 兜底：随机简单回复
        const fallbacks = [
          '你好呀~(◕‿◕✿)',
          '在呢在呢~有什么事吗？(◕‿◕✿)',
          '嗯嗯~(◕‿◕✿)'
        ];
        await sendToRoom(session, ctx, fallbacks[Math.floor(Math.random() * fallbacks.length)]);
      }

    } catch (error) {
      logger.ERROR('MSG', 'Error handling message:', error.message);
      logger.ERROR('MSG', error.stack);
    }
  });
  
  logger.INFO('INIT', 'IIROSE Claw plugin started successfully');
  
  return {
    skillManager,
    adapter,
    reload() { logger.INFO('RELOAD', 'Reloading plugin...'); },
    getSkills() { return skillManager.list(); },
    executeSkill(name, args, session) { return skillManager.execute(name, args, session); }
  };
}

/**
 * 发送消息到房间 - 兼容多种方式
 */
async function sendToRoom(session, ctx, message) {
  logger.INFO('SEND', `准备发送: ${message.substring(0, 50)}...`);
  
  try {
    // 方式1: session.send()
    const result = await session.send(message);
    logger.INFO('SEND', 'session.send 成功:', result);
    return result;
  } catch (err1) {
    logger.WARN('SEND', 'session.send 失败:', err1.message);
    
    try {
      // 方式2: session.execute()
      await session.execute(message);
      logger.INFO('SEND', 'session.execute 成功');
      return;
    } catch (err2) {
      logger.WARN('SEND', 'session.execute 失败:', err2.message);
      
      try {
        // 方式3: bot.sendMessage()
        const bot = session.bot || ctx.bots?.[0];
        if (bot && bot.sendMessage) {
          const channelId = session.channelId || session.guildId;
          await bot.sendMessage(channelId, message);
          logger.INFO('SEND', 'bot.sendMessage 成功');
          return;
        }
      } catch (err3) {
        logger.ERROR('SEND', 'bot.sendMessage 失败:', err3.message);
      }
      
      logger.ERROR('SEND', '所有发送方式都失败了');
    }
  }
}

module.exports = { name: 'iirose-claw', apply };
module.exports.OpenClawAdapter = OpenClawAdapter;
module.exports.SkillManager = SkillManager;
module.exports.createMessageHandler = createMessageHandler;
module.exports.loadConfig = loadConfig;
module.exports.loadRuntimeConfig = loadRuntimeConfig;
module.exports.mergeRuntimeConfig = mergeRuntimeConfig;
