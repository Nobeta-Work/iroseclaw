/**
 * Meme service regression test
 */

const assert = require('assert');
const {
  searchMemeByEmotion,
  getTimeoutMs,
  getStyleKeyword,
  normalizeQueryCandidates
} = require('../src/services/meme/search');
const { searchMemeByEmotion: legacyExport } = require('../src/skills/base/meme');

async function main() {
  assert.equal(typeof searchMemeByEmotion, 'function', 'service export should exist');
  assert.equal(typeof legacyExport, 'function', 'legacy meme export should stay compatible');
  assert.equal(searchMemeByEmotion, legacyExport, 'legacy meme export should reuse shared service implementation');
  assert.ok(getTimeoutMs() > 0, 'meme timeout should be a positive integer');

  const originalStyleKeyword = process.env.IROSE_MEME_STYLE_KEYWORD;

  delete process.env.IROSE_MEME_STYLE_KEYWORD;
  assert.equal(getStyleKeyword(), '白圣女', 'default meme style keyword should be 白圣女');
  assert.deepEqual(normalizeQueryCandidates('开心'), [
    'site:duitang.com 开心 表情包 白圣女',
    'site:dtstatic.com 开心 表情包 白圣女'
  ], 'emotion query should include 表情包 + 白圣女');
  assert.deepEqual(normalizeQueryCandidates(''), [
    'site:duitang.com 情绪信息 表情包 白圣女',
    'site:dtstatic.com 情绪信息 表情包 白圣女'
  ], 'empty emotion should fall back to 情绪信息');

  process.env.IROSE_MEME_STYLE_KEYWORD = '测试风格';
  assert.equal(getStyleKeyword(), '测试风格', 'style keyword env should override default');
  assert.deepEqual(normalizeQueryCandidates('疑惑'), [
    'site:duitang.com 疑惑 表情包 测试风格',
    'site:dtstatic.com 疑惑 表情包 测试风格'
  ], 'query builder should honor style keyword env override');

  if (originalStyleKeyword === undefined) {
    delete process.env.IROSE_MEME_STYLE_KEYWORD;
  } else {
    process.env.IROSE_MEME_STYLE_KEYWORD = originalStyleKeyword;
  }

  console.log('✅ PASS: meme service regression');
}

main().catch((error) => {
  console.error('❌ FAIL: meme service regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
