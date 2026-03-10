/**
 * OpenClaw Adapter
 * 负责与 OpenClaw 子代理通信
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class OpenClawAdapter {
  /**
   * @param {Object} config - OpenClaw 配置
   * @param {string} config.subagentLabel - 子代理标签
   * @param {number} config.timeout - 超时时间（毫秒）
   * @param {string[]} config.fallbackResponses - 备用响应列表
   */
  constructor(config) {
    this.config = {
      subagentLabel: config.subagentLabel || 'iirose',
      timeout: config.timeout || 30000,
      fallbackResponses: config.fallbackResponses || [
        '抱歉，我暂时无法处理这个请求。',
        '出了点问题，请稍后再试。',
        '我现在有点忙，晚点再聊吧。',
        '这个功能暂时不可用。'
      ]
    };
  }

  /**
   * 随机选择备用响应
   * @returns {string} 备用响应文本
   */
  _getRandomFallback() {
    const responses = this.config.fallbackResponses;
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * 构建协议兼容响应对象
   * @param {string} replyText - 回复文本
   * @param {string} reason - 审计原因
   * @returns {Object}
   */
  _buildProtocolResponse(replyText, reason = '') {
    return {
      requestType: 'chat',
      isOverreach: false,
      isSkillCall: false,
      skillName: null,
      skillArgs: null,
      isSystemRequest: false,
      shouldReply: true,
      replyText: replyText,
      replySegments: [],
      audit: {
        reason,
        blocked: false
      }
    };
  }

  /**
   * 从 OpenClaw JSON 输出中提取文本
   * @param {string} stdout - 标准输出
   * @returns {string}
   */
  _extractReplyTextFromJson(stdout) {
    if (typeof stdout !== 'string' || !stdout.trim()) {
      return '';
    }

    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return '';
    }

    try {
      const payload = JSON.parse(stdout.slice(start, end + 1));
      const reply = payload?.result?.payloads?.find(item => typeof item?.text === 'string' && item.text.trim());
      if (reply?.text) {
        return reply.text.trim();
      }

      if (typeof payload?.result?.text === 'string' && payload.result.text.trim()) {
        return payload.result.text.trim();
      }

      if (typeof payload?.text === 'string' && payload.text.trim()) {
        return payload.text.trim();
      }
    } catch {
      return '';
    }

    return '';
  }

  /**
   * 从普通文本输出中提取回复
   * @param {string} stdout - 标准输出
   * @returns {string}
   */
  _extractReplyTextFromPlain(stdout) {
    if (typeof stdout !== 'string' || !stdout.trim()) {
      return '';
    }

    const lines = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (
        line.startsWith('Config warnings:') ||
        line.startsWith('- plugins.entries.') ||
        line.startsWith('Gateway agent failed;')
      ) {
        continue;
      }
      return line;
    }

    return '';
  }

  /**
   * 归一化错误信息，便于审计
   * @param {Error} error - 错误对象
   * @returns {string}
   */
  _formatErrorReason(error) {
    if (!error) {
      return 'unknown error';
    }

    const stderrText = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const message = stderrText || error.message || 'unknown error';
    return message.slice(0, 1000);
  }

  /**
   * 处理消息 - 调用 OpenClaw 子代理
   * @param {Object} protocolRequest - 协议请求对象
   * @returns {Promise<Object>} 解析后的响应（兼容 protocol.parseResponse）
   */
  async processMessage(protocolRequest) {
    const { subagentLabel, timeout } = this.config;
    
    // 提取消息内容，优先 JSON 模式调用子代理
    const messageContent = typeof protocolRequest?.message?.content === 'string'
      ? protocolRequest.message.content.trim()
      : '';
    if (!messageContent) {
      return this._buildProtocolResponse(this._getRandomFallback(), 'empty message content');
    }

    const timeoutSeconds = Math.max(1, Math.ceil(timeout / 1000));
    const baseArgs = ['agent', '--agent', subagentLabel, '--message', messageContent, '--timeout', String(timeoutSeconds)];
    let lastError = null;

    try {
      const { stdout } = await execFileAsync('openclaw', [...baseArgs, '--json'], {
        timeout: timeout,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });

      const jsonReply = this._extractReplyTextFromJson(stdout);
      if (jsonReply) {
        return this._buildProtocolResponse(jsonReply);
      }
      lastError = new Error('OpenClaw JSON output did not contain reply text.');
    } catch (error) {
      lastError = error;
    }

    // 回退：兼容非 JSON 输出格式
    try {
      const { stdout } = await execFileAsync('openclaw', baseArgs, {
        timeout: timeout,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      });

      const plainReply = this._extractReplyTextFromPlain(stdout);
      if (plainReply) {
        return this._buildProtocolResponse(plainReply);
      }
      lastError = new Error('OpenClaw plain output did not contain reply text.');
    } catch (error) {
      lastError = error;
    }

    const reason = this._formatErrorReason(lastError);
    console.error('[OpenClawAdapter] Error processing message:', reason);
    return this._buildProtocolResponse(this._getRandomFallback(), reason);
  }
}

module.exports = { OpenClawAdapter };
