/**
 * Room move command regression test
 * 验证 workflow mode 下管理员可直接命令式切房
 */

const assert = require('assert');
const index = require('../src/index');

async function main() {
  let messageHandler = null;
  let movedRoom = null;

  const ctx = {
    on(event, handler) {
      if (event === 'message') {
        messageHandler = handler;
      }
    },
    before() {},
    bots: []
  };

  const app = index.apply(ctx, {
    bot: {
      uid: 'bot_uid',
      name: 'TestBot'
    },
    admins: ['admin_uid'],
    runtime: {
      mode: 'workflow'
    },
    meme: {
      enabled: false,
      triggerProbability: 0,
      requestEmotionTag: false
    }
  });

  assert.equal(typeof messageHandler, 'function', 'message handler should be registered');
  const mentionedTemplate = app.triggerTemplateRegistry.get('message.mentioned');
  assert.equal(
    mentionedTemplate.instruction.includes('转移、移动、移步、切换到某个房间'),
    true,
    'message.mentioned template should include room-move workflow instruction'
  );

  const sent = [];
  await messageHandler({
    content: 'TestBot 切房 <sharp id="68807acf5884c"/>',
    userId: 'admin_uid',
    username: 'Noβ',
    channelId: 'room-1',
    messageId: 'msg-room-1',
    bot: {
      internal: {
        async moveRoom(input) {
          movedRoom = input?.roomId || '';
        }
      }
    },
    send: async (text) => {
      sent.push(text);
      return ['msg-out-1'];
    }
  });

  assert.equal(movedRoom, '68807acf5884c', 'room.move should parse sharp room id and call internal.moveRoom');
  assert.equal(sent[0], '房间切换指令已发送。', 'room.move should acknowledge success via output runtime');

  movedRoom = null;
  sent.length = 0;

  await messageHandler({
    content: 'TestBot 切房 5ce6a4b520a90',
    userId: 'admin_uid',
    username: 'Noβ',
    channelId: 'room-1',
    messageId: 'msg-room-2',
    bot: {
      internal: {
        async moveRoom(input) {
          movedRoom = input?.roomId || '';
        }
      }
    },
    send: async (text) => {
      sent.push(text);
      return ['msg-out-2'];
    }
  });

  assert.equal(movedRoom, '5ce6a4b520a90', 'room.move should also support plain roomId command input');

  movedRoom = null;
  sent.length = 0;

  await messageHandler({
    content: 'TestBot 转移到 <sharp id="68807acf5884c"/>',
    userId: 'admin_uid',
    username: 'Noβ',
    channelId: 'room-1',
    messageId: 'msg-room-3',
    bot: {
      internal: {
        async moveRoom(input) {
          movedRoom = input?.roomId || '';
        }
      }
    },
    send: async (text) => {
      sent.push(text);
      return ['msg-out-3'];
    }
  });

  assert.equal(movedRoom, '68807acf5884c', 'room.move should support natural transfer phrasing');
  assert.equal(sent[0], '房间切换指令已发送。', 'natural transfer phrasing should still route through room.move tool');

  movedRoom = null;
  sent.length = 0;

  await messageHandler({
    content: 'TestBot 移动到 5ce6a4b520a90',
    userId: 'admin_uid',
    username: 'Noβ',
    channelId: 'room-1',
    messageId: 'msg-room-4',
    bot: {
      internal: {
        async moveRoom(input) {
          movedRoom = input?.roomId || '';
        }
      }
    },
    send: async (text) => {
      sent.push(text);
      return ['msg-out-4'];
    }
  });

  assert.equal(movedRoom, '5ce6a4b520a90', 'room.move should support natural move phrasing with plain room id');
  console.log('✅ PASS: room move command regression');
}

main().catch((error) => {
  console.error('❌ FAIL: room move command regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
