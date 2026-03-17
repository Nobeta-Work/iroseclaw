/**
 * Image tag interceptor test
 */

const assert = require('assert');
const {
  replaceImageTags,
  buildImageEmotionTag,
  registerImageTagInterceptor,
  normalizeEmotion
} = require('../src/plugins/image-tag-interceptor');

async function main() {
  assert.equal(normalizeEmotion('开心'), '开心', 'should keep supported emotion');
  assert.equal(normalizeEmotion('happy'), '开心', 'should map alias emotion');
  assert.equal(normalizeEmotion('未知情绪'), '', 'should reject unsupported emotion');

  assert.equal(buildImageEmotionTag('开心'), '$image＝开心$', 'should build standard tag');
  assert.equal(buildImageEmotionTag('unknown'), '', 'should reject invalid tag build');

  const unchanged = await replaceImageTags('普通文本，不包含标记。');
  assert.equal(unchanged, '普通文本，不包含标记。', 'text without marker should stay unchanged');

  const unresolved = await replaceImageTags('测试 $image＝未知$ 内容', {
    resolveImageByEmotion: async () => 'https://example.com/xx.gif'
  });
  assert.equal(unresolved, '测试 $image＝未知$ 内容', 'unknown emotion should pass through');

  let resolverCalls = 0;
  const replaced = await replaceImageTags('A$image＝开心$B$image=happy$C', {
    resolveImageByEmotion: async (emotion) => {
      resolverCalls += 1;
      return `https://img.test/${emotion}.gif`;
    }
  });

  assert.equal(replaced, 'A[https://img.test/开心.gif#e]B[https://img.test/开心.gif#e]C', 'should replace markers to image segments');
  assert.equal(resolverCalls, 1, 'same normalized emotion should hit cache once');

  let hook = null;
  const fakeCtx = {
    before(eventName, callback) {
      if (eventName === 'send') {
        hook = callback;
      }
    }
  };

  registerImageTagInterceptor(fakeCtx, {
    enabled: true,
    resolveImageByEmotion: async () => 'https://img.test/happy.gif'
  });

  assert.equal(typeof hook, 'function', 'send hook should be registered');

  const fakeSession = {
    elements: [
      { type: 'text', attrs: { content: 'hello $image＝开心$ world' } }
    ]
  };

  await hook(fakeSession);
  assert.equal(
    fakeSession.elements[0].attrs.content,
    'hello [https://img.test/happy.gif#e] world',
    'hook should replace marker before send'
  );

  console.log('✅ PASS: image tag interceptor');
}

main().catch((error) => {
  console.error('❌ FAIL: image tag interceptor');
  console.error(error.stack || error.message);
  process.exit(1);
});
