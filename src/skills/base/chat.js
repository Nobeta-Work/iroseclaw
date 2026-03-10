/**
 * Chat Skill
 * 聊天技能（默认技能）
 * 实际聊天由 OpenClaw 子代理处理，这里只是占位注册
 */

/**
 * 创建聊天技能
 * @param {Object} skillManager - 技能管理器实例
 * @returns {Object} 聊天技能对象
 */
function createChatSkill(skillManager) {
  return {
    name: 'chat',
    keywords: ['聊天', '对话', '说话', 'hi', 'hello', '你好', '在吗'],
    description: '与机器人进行日常聊天对话',
    
    /**
     * 聊天处理器
     * @param {Object} context - 上下文对象
     * @param {Object} context.session - 会话对象
     * @param {Object} context.args - 参数对象
     * @returns {null} 返回 null，由 OpenClaw 子代理处理实际聊天
     */
    handler: async ({ session, args }) => {
      // 实际聊天由 OpenClaw 子代理处理
      // 这里只是占位注册，返回 null 表示不拦截
      return null;
    }
  };
}

module.exports = { createChatSkill };
