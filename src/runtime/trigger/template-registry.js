/**
 * Trigger template registry
 * 支持插件动态注册 trigger templates
 */

const {
  DEFAULT_TEMPLATE_NAME,
  getTriggerTemplate,
  normalizeTriggerTemplate,
  resolveTemplateTools
} = require('./templates');

class TriggerTemplateRegistry {
  constructor() {
    this.templates = new Map();
  }

  register(kind, template) {
    const normalizedKind = String(kind || '').trim() || DEFAULT_TEMPLATE_NAME;
    const baseTemplate = this.templates.get(normalizedKind) || getTriggerTemplate(normalizedKind);
    const normalizedTemplate = normalizeTriggerTemplate({
      ...template,
      name: template?.name || normalizedKind
    }, baseTemplate);
    this.templates.set(normalizedKind, normalizedTemplate);
    return normalizedTemplate;
  }

  has(kind) {
    const normalizedKind = String(kind || '').trim();
    return this.templates.has(normalizedKind);
  }

  get(kind = '') {
    const normalizedKind = String(kind || '').trim();
    if (this.templates.has(normalizedKind)) {
      return normalizeTriggerTemplate(this.templates.get(normalizedKind));
    }
    if (this.templates.has(DEFAULT_TEMPLATE_NAME)) {
      return normalizeTriggerTemplate(this.templates.get(DEFAULT_TEMPLATE_NAME));
    }
    return getTriggerTemplate(normalizedKind);
  }

  list() {
    return Array.from(this.templates.entries()).map(([kind, template]) => ({
      kind,
      ...normalizeTriggerTemplate(template)
    }));
  }

  resolveTools(toolRegistry, kind = '') {
    return resolveTemplateTools(toolRegistry, this.get(kind));
  }
}

module.exports = {
  TriggerTemplateRegistry
};
