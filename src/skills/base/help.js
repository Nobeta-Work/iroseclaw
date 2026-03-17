/**
 * Help Skill
 * 帮助技能 - 列出所有已注册技能
 */

const { renderHelpOverview } = require('../../services/help/overview');

/**
 * 创建帮助技能
 * @param {Object} skillManager - 技能管理器实例
 * @returns {Object} 帮助技能对象
 */
function createHelpSkill(skillManager) {
  return {
    name: 'help',
    keywords: ['帮助', 'help', '命令', '功能', '技能', '指令'],
    description: '查看机器人所有可用功能和命令',
    
    /**
     * 帮助处理器
     * @param {Object} context - 上下文对象
     * @param {Object} context.session - 会话对象
     * @param {Object} context.args - 参数对象
     * @returns {string} 格式化的帮助文本
     */
    handler: async ({ session, args }) => {
      return renderHelpOverview({
        skills: skillManager.list(),
        tools: []
      });
    }
  };
}

module.exports = { createHelpSkill };
