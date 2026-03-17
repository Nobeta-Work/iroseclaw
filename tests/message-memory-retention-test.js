/**
 * Message memory retention regression test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MessageMemoryStore } = require('../src/plugins/message-memory');

async function testPersistedFileRetention() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'message-memory-retain-'));
  const store = new MessageMemoryStore({
    enabled: true,
    persist: true,
    dataDir: tempDir,
    maxEventsPerChannel: 5,
    compactCheckInterval: 1,
    compactOnStartup: true
  });

  for (let i = 0; i < 12; i += 1) {
    store.addUserMessage({
      channelId: 'room-retention',
      messageId: `m${i}`,
      userId: 'u1',
      username: 'Tester',
      content: `msg-${i}`,
      timestamp: 1000 + i
    });
  }

  const files = fs.readdirSync(tempDir).filter(item => item.endsWith('.jsonl'));
  assert.equal(files.length, 1, 'store should persist one channel file');
  const filePath = path.join(tempDir, files[0]);
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 5, 'persisted channel file should be compacted to maxEventsPerChannel');

  const parsed = lines.map(line => JSON.parse(line));
  assert.equal(parsed[0].content, 'msg-7', 'oldest retained line should match tail window');
  assert.equal(parsed[4].content, 'msg-11', 'latest retained line should match newest event');

  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function testAnchorRoundsRetention() {
  const store = new MessageMemoryStore({
    enabled: true,
    persist: false,
    maxEventsPerChannel: 400,
    maxAnchorRounds: 20,
    detailedAnchorCount: 5,
    summaryAnchorCount: 4
  });

  for (let i = 1; i <= 30; i += 1) {
    store.addUserMessage({
      channelId: 'room-anchor',
      messageId: `u${i}`,
      userId: 'u1',
      username: 'Tester',
      content: `@bot q${i}`,
      isMentionBot: true,
      timestamp: 1000 + i * 2
    });
    store.addBotMessage({
      channelId: 'room-anchor',
      messageId: `b${i}`,
      userId: 'bot',
      username: 'Bot',
      content: `a${i}`,
      timestamp: 1000 + i * 2 + 1
    });
  }

  const context = store.buildContext({
    channelId: 'room-anchor',
    userId: 'u1',
    username: 'Tester',
    currentContent: '@bot q30',
    timestamp: 9999
  });

  assert.equal(context.anchorCount, 30, 'anchorCount should represent total history');
  assert.equal(context.anchorCountRetained, 20, 'retained anchor rounds should be capped');
  assert.ok(
    context.historySummary.some(item => item.includes('更早共 10 轮 @bot 记忆已压缩')),
    'history summary should describe dropped anchor rounds'
  );
}

async function main() {
  await testPersistedFileRetention();
  await testAnchorRoundsRetention();
  console.log('✅ PASS: message memory retention regression');
}

main().catch((error) => {
  console.error('❌ FAIL: message memory retention regression');
  console.error(error.stack || error.message);
  process.exit(1);
});

