/**
 * Help Skill
 * 帮助技能 - 列出所有已注册技能
 */

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
      const skills = skillManager.list();
      
      // 统一帮助文本
      let helpText = '✨ **机器人技能列表** ✨\n\n';
      helpText += '━━━━━━━━━━━━━━━━━━\n\n';
      
      if (skills.length === 0) {
        helpText += '⚠️ 暂无可用技能\n';
      } else {
        for (const skill of skills) {
          const keywords = skill.keywords?.length > 0 
            ? skill.keywords.join(' | ') 
            : '无关键词';
          
          helpText += `🔹 **${skill.name}**\n`;
          helpText += `   关键词：${keywords}\n`;
          helpText += `   说明：${skill.description || '无描述'}\n\n`;
        }
      }
      
      helpText += '━━━━━━━━━━━━━━━━━━\n\n';
      helpText += '💡 使用方法：@机器人 + 技能关键词 + 内容\n';
      helpText += '📌 示例：@Bot 点歌 周杰伦\n';
      
      return helpText;
    }
  };
}

module.exports = { createHelpSkill };
