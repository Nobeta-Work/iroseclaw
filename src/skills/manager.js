/**
 * Skill Manager
 * 技能管理器 - 注册、加载、执行技能
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const REMOTE_PLUGIN_CACHE_DIR = path.join(process.cwd(), 'data', 'remote-plugins');

function toInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function normalizeRemoteEntry(entry, defaultTimeout) {
  if (typeof entry === 'string') {
    return {
      url: entry.trim(),
      enabled: true,
      timeout: defaultTimeout,
      sha256: ''
    };
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  return {
    url: typeof entry.url === 'string' ? entry.url.trim() : '',
    enabled: entry.enabled !== false,
    timeout: toInt(entry.timeout, defaultTimeout),
    sha256: typeof entry.sha256 === 'string' ? entry.sha256.trim() : ''
  };
}

function normalizeSha256(value) {
  if (!value) return '';
  return value.replace(/^sha256[:\-]/i, '').toLowerCase();
}

async function downloadRemotePlugin(url, timeoutMs, allowHttp) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsed, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'iroseclaw-remote-plugin-loader/0.1'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const sourceCode = await response.text();
    if (!sourceCode.trim()) {
      throw new Error('Empty plugin source');
    }

    return {
      sourceCode,
      finalUrl: response.url || parsed.href
    };
  } finally {
    clearTimeout(timer);
  }
}

class SkillManager {
  constructor() {
    // 技能注册表：Map<skillName, { handler, options, keywords }>
    this.skills = new Map();
    this.registerListeners = new Set();
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
    if (this.skills.has(name)) {
      console.warn(`[SkillManager] Skill overwritten: ${name}`);
    }
    const skill = {
      name,
      handler,
      keywords: options.keywords || [],
      description: options.description || ''
    };
    this.skills.set(name, skill);
    console.log(`[SkillManager] Registered skill: ${name}`);

    for (const listener of this.registerListeners) {
      try {
        listener(skill);
      } catch (error) {
        console.error(`[SkillManager] Register listener failed for ${name}:`, error.message);
      }
    }
  }

  onRegister(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('register listener must be a function');
    }

    this.registerListeners.add(listener);
    return () => this.registerListeners.delete(listener);
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
   * 从模块导出中注册技能
   * @param {any} skillModule - 模块导出
   * @param {Object} [options]
   * @param {SkillManager} [options.targetManager]
   * @returns {boolean}
   */
  _registerFromModule(skillModule, options = {}) {
    const targetManager = options.targetManager || this;
    const registerSkill = (skill) => {
      if (!skill || !skill.name || typeof skill.handler !== 'function') {
        return false;
      }
      targetManager.register(skill.name, skill.handler, {
        keywords: skill.keywords,
        description: skill.description
      });
      return true;
    };

    if (registerSkill(skillModule)) return true;
    if (registerSkill(skillModule?.default)) return true;

    if (typeof skillModule === 'function') {
      return registerSkill(skillModule(targetManager));
    }

    if (typeof skillModule?.default === 'function') {
      return registerSkill(skillModule.default(targetManager));
    }

    if (skillModule && typeof skillModule === 'object') {
      const factoryFunc = Object.values(skillModule).find(v => typeof v === 'function');
      if (factoryFunc) {
        return registerSkill(factoryFunc(targetManager));
      }
    }

    return false;
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
        const loaded = this._registerFromModule(skillModule, { targetManager: self });
        if (!loaded) {
          console.error(`[SkillManager] Invalid skill export in ${file}`);
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
          const loaded = this._registerFromModule(script);
          if (!loaded) {
            console.error(`[SkillManager] Invalid JS script export ${file}`);
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

  /**
   * 加载远程插件（URL -> 本地缓存 -> require）
   * @param {Object|Array} remoteConfig - 远程插件配置
   */
  async loadRemotePlugins(remoteConfig = {}) {
    const config = Array.isArray(remoteConfig) ? { entries: remoteConfig } : (remoteConfig || {});
    const entries = Array.isArray(config.entries) ? config.entries : [];

    if (entries.length === 0) {
      return;
    }

    const allowHttp = Boolean(config.allowHttp);
    const timeout = toInt(config.timeout, 10000);

    fs.mkdirSync(REMOTE_PLUGIN_CACHE_DIR, { recursive: true });

    for (const rawEntry of entries) {
      const entry = normalizeRemoteEntry(rawEntry, timeout);
      if (!entry || !entry.url || !entry.enabled) continue;

      const expectedHash = normalizeSha256(entry.sha256);
      const sourceHash = crypto.createHash('sha1').update(entry.url).digest('hex');
      const localFilePath = path.join(REMOTE_PLUGIN_CACHE_DIR, `${sourceHash}.js`);

      try {
        const { sourceCode, finalUrl } = await downloadRemotePlugin(entry.url, entry.timeout, allowHttp);
        const actualSha256 = crypto.createHash('sha256').update(sourceCode, 'utf8').digest('hex');

        if (expectedHash && expectedHash !== actualSha256) {
          throw new Error(`sha256 mismatch (expected ${expectedHash}, got ${actualSha256})`);
        }

        const banner = [
          '/**',
          ` * Remote plugin cache`,
          ` * source: ${finalUrl}`,
          ` * fetchedAt: ${new Date().toISOString()}`,
          ` * sha256: ${actualSha256}`,
          ' */',
          ''
        ].join('\n');

        fs.writeFileSync(localFilePath, banner + sourceCode, 'utf8');

        try {
          delete require.cache[require.resolve(localFilePath)];
        } catch {
          // ignore cache miss
        }

        const script = require(localFilePath);
        const loaded = this._registerFromModule(script);
        if (!loaded) {
          throw new Error('invalid remote plugin export');
        }

        console.log(`[SkillManager] Loaded remote plugin: ${entry.url}`);
      } catch (error) {
        console.error(`[SkillManager] Failed to load remote plugin ${entry.url}:`, error.message);
      }
    }
  }
}

module.exports = { SkillManager };
