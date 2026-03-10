/**
 * Skill Manager
 * 技能管理器 - 注册、加载、执行技能
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class SkillManager {
  constructor() {
    // 技能注册表：Map<skillName, { handler, options, keywords }>
    this.skills = new Map();
  }

  /**
   * 注册技能
   * @param {string} name - 技能名称
   * @param {Function} handler - 技能处理函数
   * @param {Object} options - 技能选项
   * @param {string[]} options.keywords - 关键词列表
   * @param {string} options.description - 技能描述
   */
  register(name, handler, options = {}) {
    this.skills.set(name, {
      name,
      handler,
      keywords: options.keywords || [],
      description: options.description || ''
    });
    console.log(`[SkillManager] Registered skill: ${name}`);
  }

  /**
   * 执行技能
   * @param {string} name - 技能名称
   * @param {Object} args - 技能参数
   * @param {Object} session - 会话对象
   * @returns {Promise<any>} 技能执行结果
   */
  async execute(name, args, session) {
    const skill = this.skills.get(name);
    
    if (!skill) {
      console.error(`[SkillManager] Skill not found: ${name}`);
      return null;
    }

    try {
      const result = await skill.handler({ session, args });
      return result;
    } catch (error) {
      console.error(`[SkillManager] Error executing skill ${name}:`, error.message);
      return `技能执行失败：${error.message}`;
    }
  }

  /**
   * 列出所有技能
   * @returns {Array} 技能列表
   */
  list() {
    return Array.from(this.skills.values()).map(skill => ({
      name: skill.name,
      keywords: skill.keywords,
      description: skill.description
    }));
  }

  /**
   * 根据消息查找匹配的技能
   * @param {string} message - 用户消息
   * @returns {Object|null} 匹配的技能或 null
   */
  find(message) {
    const lowerMessage = message.toLowerCase();
    
    for (const skill of this.skills.values()) {
      for (const keyword of skill.keywords) {
        if (lowerMessage.includes(keyword.toLowerCase())) {
          return skill;
        }
      }
    }
    
    return null;
  }

  /**
   * 加载内置技能（src/skills/base/ 目录）
   * @param {Object} options - 加载选项
   * @param {Object} options.skillManager - 技能管理器实例（用于工厂函数）
   */
  loadBuiltin(options = {}) {
    const baseDir = path.join(__dirname, 'base');
    const self = options.skillManager || this;
    
    if (!fs.existsSync(baseDir)) {
      console.log('[SkillManager] Base skills directory not found');
      return;
    }

    const files = fs.readdirSync(baseDir).filter(f => f.endsWith('.js'));
    
    for (const file of files) {
      try {
        const skillModule = require(path.join(baseDir, file));
        
        // 支持两种导出格式：
        // 1. 直接导出 { name, keywords, description, handler }
        // 2. 导出工厂函数 createXxxSkill(skillManager)
        
        if (skillModule.name && skillModule.handler) {
          // 直接导出格式
          self.register(skillModule.name, skillModule.handler, {
            keywords: skillModule.keywords,
            description: skillModule.description
          });
        } else if (skillModule.default && skillModule.default.name && skillModule.default.handler) {
          // default 导出格式
          self.register(skillModule.default.name, skillModule.default.handler, {
            keywords: skillModule.default.keywords,
            description: skillModule.default.description
          });
        } else {
          // 工厂函数模式：查找 createXxxSkill 函数
          const factoryFunc = Object.values(skillModule).find(v => typeof v === 'function');
          
          if (factoryFunc) {
            const skill = factoryFunc(self);
            if (skill && skill.name && skill.handler) {
              self.register(skill.name, skill.handler, {
                keywords: skill.keywords,
                description: skill.description
              });
            }
          }
        }
      } catch (error) {
        console.error(`[SkillManager] Failed to load skill ${file}:`, error.message);
      }
    }
  }

  /**
   * 加载脚本目录（src/scripts/）
   * @param {string} dir - 脚本目录路径
   */
  async loadScripts(dir) {
    if (!fs.existsSync(dir)) {
      console.log(`[SkillManager] Scripts directory not found: ${dir}`);
      return;
    }

    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      
      if (file.endsWith('.js')) {
        // JavaScript 脚本
        try {
          const script = require(filePath);
          
          if (script.name && script.handler) {
            this.register(script.name, script.handler, {
              keywords: script.keywords || [],
              description: script.description || ''
            });
          }
        } catch (error) {
          console.error(`[SkillManager] Failed to load JS script ${file}:`, error.message);
        }
      } else if (file.endsWith('.py')) {
        // Python 脚本 - 通过子进程调用
        try {
          const scriptName = path.basename(file, '.py');
          
          // 创建包装器
          const pythonHandler = async ({ session, args }) => {
            const input = JSON.stringify({ session, args });
            const escapedInput = input.replace(/'/g, "'\\''");
            
            const command = `python3 '${filePath}' '${escapedInput}'`;
            
            try {
              const { stdout } = await execAsync(command, {
                timeout: 30000,
                encoding: 'utf8'
              });
              
              // 解析 JSON 输出
              return JSON.parse(stdout.trim());
            } catch (error) {
              console.error(`[SkillManager] Python script ${file} error:`, error.message);
              return `Python 脚本执行失败：${error.message}`;
            }
          };
          
          this.register(scriptName, pythonHandler, {
            keywords: [scriptName],
            description: `Python 脚本：${file}`
          });
        } catch (error) {
          console.error(`[SkillManager] Failed to register Python script ${file}:`, error.message);
        }
      }
    }
  }
}

module.exports = { SkillManager };
