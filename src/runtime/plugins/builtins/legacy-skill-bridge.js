/**
 * Builtin plugin: legacy skill bridge
 */

const { bridgeSkillManagerToToolRegistry } = require('../../../tools/compat/skill-bridge');

module.exports = {
  name: 'builtin-legacy-skill-bridge',
  apply(host) {
    if (!host.skillManager) {
      return;
    }
    bridgeSkillManagerToToolRegistry(host.skillManager, host.toolRegistry, {
      hiddenSkills: ['chat', 'help', 'music', 'meme']
    });
  }
};
