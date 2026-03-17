/**
 * Music logging metadata regression test
 */

const assert = require('assert');
const { extractUrlHost, resolvePlayUrl } = require('../src/services/music/providers');

async function main() {
  assert.equal(extractUrlHost('https://media.example.com/song/1.mp3'), 'media.example.com', 'extractUrlHost should parse host');
  assert.equal(extractUrlHost('not-a-url'), '', 'extractUrlHost should return empty string for invalid urls');

  const resolved = await resolvePlayUrl('2084034562', {
    playUrlProviders: ['customTemplate'],
    providers: {
      customTemplate: {
        enabled: true,
        urlTemplate: 'https://media.example.com/song/{{id}}.mp3'
      },
      iarcDirect: {
        enabled: false,
        urlTemplate: ''
      },
      metingRedirect: {
        enabled: false,
        endpointTemplate: ''
      },
      neteaseOuter: {
        enabled: false,
        urlTemplate: ''
      }
    }
  });

  assert.equal(resolved.provider, 'customTemplate', 'resolveSongCard should expose resolved provider');
  assert.equal(extractUrlHost(resolved.url), 'media.example.com', 'resolved play url should expose host diagnostics');
  console.log('✅ PASS: music logging metadata regression');
}

main().catch((error) => {
  console.error('❌ FAIL: music logging metadata regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
