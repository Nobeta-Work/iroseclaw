/**
 * Admin follow room regression test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const index = require('../src/index');

function createTestContext() {
  const handlers = new Map();

  return {
    on(event, handler) {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      handlers.get(event).push(handler);
      return () => {
        const bucket = handlers.get(event) || [];
        handlers.set(event, bucket.filter(item => item !== handler));
      };
    },
    before() {},
    bots: [],
    _handlers: handlers
  };
}

async function dispatchMessage(ctx, session) {
  const handlers = ctx._handlers.get('message') || [];
  for (const handler of handlers) {
    await handler(session);
  }
}

async function dispatchEvent(ctx, eventName, session, data) {
  const handlers = ctx._handlers.get(eventName) || [];
  for (const handler of handlers) {
    await handler(session, data);
  }
}

async function testAdminCommandsAndFollow() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-follow-room-commands-'));
  const ctx = createTestContext();

  try {
    const app = index.apply(ctx, {
      bot: {
        uid: 'bot_uid',
        name: 'TestBot'
      },
      admins: ['admin_uid'],
      runtime: {
        mode: 'workflow'
      },
      pluginConfigs: {
        'iirose-admin-follow-room': {
          dataDir: tempDir,
          debounceMs: 2000
        }
      },
      messageMemory: {
        persist: false
      },
      meme: {
        enabled: false,
        triggerProbability: 0,
        requestEmotionTag: false
      }
    });

    const service = app.pluginHost.getService('iirose.admin-follow-room');
    assert.ok(service, 'follow room service should be registered');
    assert.equal(service.getStatus().enabled, false, 'follow room should default to disabled');

    const sent = [];

    await dispatchMessage(ctx, {
      content: '开启跟随切房',
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'private:admin_uid',
      messageId: 'private-enable-1',
      send: async (text) => {
        sent.push(text);
        return ['private-enable-out'];
      }
    });

    assert.equal(service.getStatus().enabled, true, 'enable command should turn follow mode on');
    assert.equal(sent[sent.length - 1].includes('已开启管理员跟随切房'), true, 'enable command should acknowledge opening');

    await dispatchMessage(ctx, {
      content: '跟随切房状态',
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'private:admin_uid',
      messageId: 'private-status-1',
      send: async (text) => {
        sent.push(text);
        return ['private-status-out'];
      }
    });

    const statusReply = sent[sent.length - 1];
    assert.equal(statusReply.includes('管理员跟随切房状态'), true, 'status command should render title');
    assert.equal(statusReply.includes('状态: 已开启'), true, 'status command should reflect enabled state');

    let currentRoom = 'room-origin';
    const movedRooms = [];

    await dispatchEvent(ctx, 'iirose/guild-member-switchRoom', {
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'room-origin',
      bot: {
        internal: {
          async getRoomId() {
            return currentRoom;
          },
          async moveRoom(input) {
            movedRooms.push(input?.roomId || '');
            currentRoom = input?.roomId || currentRoom;
          }
        }
      },
      send: async () => ['event-out-1']
    }, {
      uid: 'admin_uid',
      username: 'Admin',
      room: 'room-origin',
      targetRoom: 'room-target'
    });

    assert.deepEqual(movedRooms, ['room-target'], 'enabled follow mode should move bot to admin target room');
    assert.equal(service.getStatus().lastTargetRoom, 'room-target', 'service should record last followed room');

    await dispatchMessage(ctx, {
      content: '关闭跟随切房',
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'private:admin_uid',
      messageId: 'private-disable-1',
      send: async (text) => {
        sent.push(text);
        return ['private-disable-out'];
      }
    });

    assert.equal(service.getStatus().enabled, false, 'disable command should turn follow mode off');

    await dispatchEvent(ctx, 'iirose/guild-member-switchRoom', {
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'room-target',
      bot: {
        internal: {
          async getRoomId() {
            return currentRoom;
          },
          async moveRoom(input) {
            movedRooms.push(input?.roomId || '');
          }
        }
      },
      send: async () => ['event-out-2']
    }, {
      uid: 'admin_uid',
      username: 'Admin',
      room: 'room-target',
      targetRoom: 'room-next'
    });

    assert.deepEqual(movedRooms, ['room-target'], 'disabled follow mode should not move bot again');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testLeaderAndOriginGuards() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-follow-room-guards-'));
  const ctx = createTestContext();

  try {
    index.apply(ctx, {
      bot: {
        uid: 'bot_uid',
        name: 'TestBot'
      },
      admins: ['admin_uid', 'other_admin_uid'],
      runtime: {
        mode: 'workflow'
      },
      pluginConfigs: {
        'iirose-admin-follow-room': {
          dataDir: tempDir,
          defaultEnabled: true,
          leaderUid: 'admin_uid',
          debounceMs: 5000,
          onlyWhenLeavingCurrentRoom: true
        }
      },
      messageMemory: {
        persist: false
      },
      meme: {
        enabled: false,
        triggerProbability: 0,
        requestEmotionTag: false
      }
    });

    const movedRooms = [];
    let currentRoom = 'room-origin';
    const session = {
      userId: 'admin_uid',
      username: 'Admin',
      channelId: 'room-origin',
      bot: {
        internal: {
          async getRoomId() {
            return currentRoom;
          },
          async moveRoom(input) {
            movedRooms.push(input?.roomId || '');
          }
        }
      },
      send: async () => ['event-out']
    };

    await dispatchEvent(ctx, 'iirose/guild-member-switchRoom', session, {
      uid: 'other_admin_uid',
      username: 'OtherAdmin',
      room: 'room-origin',
      targetRoom: 'room-other'
    });

    assert.equal(movedRooms.length, 0, 'non-leader admin should not trigger follow when leaderUid is configured');

    await dispatchEvent(ctx, 'iirose/guild-member-switchRoom', session, {
      uid: 'admin_uid',
      username: 'Admin',
      room: 'room-somewhere-else',
      targetRoom: 'room-target'
    });

    assert.equal(movedRooms.length, 0, 'admin leaving another room should not pull bot away when origin guard is enabled');

    await dispatchEvent(ctx, 'iirose/guild-member-switchRoom', session, {
      uid: 'admin_uid',
      username: 'Admin',
      room: 'room-origin',
      targetRoom: 'room-target'
    });

    assert.deepEqual(movedRooms, ['room-target'], 'configured leader leaving current room should trigger follow');

    await dispatchEvent(ctx, 'iirose/guild-member-switchRoom', session, {
      uid: 'admin_uid',
      username: 'Admin',
      room: 'room-origin',
      targetRoom: 'room-target'
    });

    assert.deepEqual(movedRooms, ['room-target'], 'duplicate event inside debounce window should not move twice');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  await testAdminCommandsAndFollow();
  await testLeaderAndOriginGuards();
  console.log('✅ PASS: admin follow room regression');
}

main().catch((error) => {
  console.error('❌ FAIL: admin follow room regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
