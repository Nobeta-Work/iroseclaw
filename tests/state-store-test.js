/**
 * State store regression test
 */

const assert = require('assert');
const { MemoryStateStore } = require('../src/runtime/state/memory-store');

async function main() {
  const store = new MemoryStateStore();

  const initial = await store.get('room', 'room-1');
  assert.equal(initial, null, 'missing state should return null');

  await store.set('room', 'room-1', {
    counter: 1
  });
  const afterSet = await store.get('room', 'room-1');
  assert.deepEqual(afterSet, { counter: 1 }, 'set should persist state');

  await store.patch('room', 'room-1', {
    nested: {
      enabled: true
    }
  });
  await store.patch('room', 'room-1', {
    counter: 2,
    nested: {
      label: 'ok'
    }
  });
  const afterPatch = await store.get('room', 'room-1');
  assert.deepEqual(afterPatch, {
    counter: 2,
    nested: {
      enabled: true,
      label: 'ok'
    }
  }, 'patch should merge nested objects');

  const deleted = await store.delete('room', 'room-1');
  assert.equal(deleted, true, 'delete should report removed key');
  const afterDelete = await store.get('room', 'room-1');
  assert.equal(afterDelete, null, 'deleted state should no longer exist');

  console.log('✅ PASS: state store regression');
}

main().catch((error) => {
  console.error('❌ FAIL: state store regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
