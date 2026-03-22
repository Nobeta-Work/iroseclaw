/**
 * Trigger router regression test
 */

const assert = require('assert');
const { TriggerRouter } = require('../src/runtime/trigger/router');

async function main() {
  const router = new TriggerRouter({
    botProfile: {
      uid: 'bot_uid',
      name: 'TestBot'
    },
    adminUids: ['admin_uid']
  });

  const mentioned = router.routeMessage({
    content: '<at id="bot_uid" name="TestBot"/> 你好',
    userId: 'u1',
    username: 'Tester',
    channelId: 'room-1',
    messageId: 'm1'
  });

  assert.equal(mentioned.shouldHandle, true, 'mentioned message should be handled');
  assert.equal(mentioned.cleanedContent, '你好', 'mentioned content should be cleaned');
  assert.equal(mentioned.kind, 'message.mentioned', 'room mention should be normalized as message.mentioned');

  const nativeUidMention = router.routeMessage({
    content: '[@bot_uid@] 原生UID提及',
    userId: 'u1',
    username: 'Tester',
    channelId: 'room-1',
    messageId: 'm1b'
  });

  assert.equal(nativeUidMention.shouldHandle, true, 'native uid mention should be handled');
  assert.equal(nativeUidMention.cleanedContent, '原生UID提及', 'native uid mention should be cleaned');

  const nativeNameMention = router.routeMessage({
    content: '[*TestBot*] 原生名字提及',
    userId: 'u1',
    username: 'Tester',
    channelId: 'room-1',
    messageId: 'm1c'
  });

  assert.equal(nativeNameMention.shouldHandle, true, 'native name mention should be handled');
  assert.equal(nativeNameMention.cleanedContent, '原生名字提及', 'native name mention should be cleaned');

  const privateNonAdmin = router.routeMessage({
    content: '你好',
    userId: 'u2',
    username: 'Tester2',
    channelId: 'private:u2',
    messageId: 'm2'
  });

  assert.equal(privateNonAdmin.shouldHandle, false, 'non-admin private message should not be handled');
  assert.equal(privateNonAdmin.blockedReason, 'private_non_admin', 'blocked reason should be preserved');

  const privateAdmin = router.routeMessage({
    content: '你好',
    userId: 'admin_uid',
    username: 'Admin',
    channelId: 'private:admin_uid',
    messageId: 'm3'
  });

  assert.equal(privateAdmin.shouldHandle, true, 'admin private message should be handled');
  assert.equal(privateAdmin.kind, 'message.private', 'private message should be normalized as message.private');

  const switchRoom = router.routePlatformEvent('iirose/guild-member-switchRoom', {
    channelId: 'room-origin',
    userId: 'u3',
    username: 'Mover'
  }, {
    uid: 'u3',
    username: 'Mover',
    room: 'room-origin',
    targetRoom: 'room-target'
  });

  assert.equal(switchRoom.kind, 'iirose.switch_room', 'known event should map to normalized trigger kind');
  assert.equal(switchRoom.eventData.targetRoom, 'room-target', 'event data should be preserved');

  console.log('✅ PASS: trigger router regression');
}

main().catch((error) => {
  console.error('❌ FAIL: trigger router regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
