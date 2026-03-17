/**
 * Tool registry matching regression test
 */

const assert = require('assert');
const { ToolRegistry } = require('../src/tools/registry');

async function main() {
  const registry = new ToolRegistry();

  registry.register({
    name: 'help',
    description: 'legacy help',
    aliases: ['帮助', 'help'],
    inputSchema: {},
    outputSchema: {},
    permission: ['help'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 1000,
    origin: 'legacy-skill',
    metadata: {
      directMatch: false,
      workflowVisible: false
    },
    async execute() {
      return null;
    }
  });

  registry.register({
    name: 'help.show',
    description: 'canonical help',
    aliases: ['帮助', 'help'],
    inputSchema: {},
    outputSchema: {},
    permission: ['help'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 1000,
    origin: 'builtin',
    metadata: {
      directMatch: true
    },
    async execute() {
      return null;
    }
  });

  registry.register({
    name: 'meme.internal',
    description: 'internal tool',
    aliases: ['表情'],
    inputSchema: {},
    outputSchema: {},
    permission: ['chat'],
    scopes: ['current-session'],
    readOnly: true,
    sideEffect: false,
    riskLevel: 'low',
    timeoutMs: 1000,
    origin: 'builtin',
    metadata: {
      directMatch: false
    },
    async execute() {
      return null;
    }
  });

  registry.register({
    name: 'music.play_netease',
    description: 'canonical music',
    aliases: ['点歌', '音乐', 'play', 'music'],
    inputSchema: {},
    outputSchema: {},
    permission: ['music'],
    scopes: ['current-session'],
    readOnly: false,
    sideEffect: true,
    riskLevel: 'medium',
    timeoutMs: 1000,
    origin: 'builtin',
    metadata: {
      directMatch: true,
      directAliases: ['点歌']
    },
    async execute() {
      return null;
    }
  });

  const helpMatch = registry.matchMessage('帮助');
  const internalMatch = registry.matchMessage('表情');
  const musicMatch = registry.matchMessage('点歌 稻香');
  const musicAliasMatch = registry.matchMessage('music 稻香');
  const musicNonPrefixMatch = registry.matchMessage('我想点歌 稻香');
  const visibleTools = registry.list({ workflowVisibleOnly: true });

  assert.equal(helpMatch?.name, 'help.show', 'builtin canonical tool should win over legacy bridge');
  assert.equal(internalMatch, null, 'directMatch=false tool should be ignored by default');
  assert.equal(musicMatch?.name, 'music.play_netease', 'tool with directAliases should match its single direct entry');
  assert.equal(musicAliasMatch, null, 'workflow aliases should not be used as direct entry when directAliases is set');
  assert.equal(musicNonPrefixMatch, null, 'direct entry matching should require prefix form');
  assert.equal(visibleTools.some(tool => tool.name === 'help'), false, 'hidden legacy tool should not be workflow-visible');

  console.log('✅ PASS: tool registry matching regression');
}

main().catch((error) => {
  console.error('❌ FAIL: tool registry matching regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
