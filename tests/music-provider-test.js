/**
 * Music provider regression test
 */

const assert = require('assert');
const { getMusicProviderConfig, resolvePlayUrl } = require('../src/services/music/providers');

async function main() {
  const config = getMusicProviderConfig({
    music: {
      playUrlProviders: ['customTemplate', 'iarcDirect', 'neteaseOuter'],
      providers: {
        customTemplate: {
          enabled: true,
          urlTemplate: 'https://media.example.com/song/{{id}}.mp3'
        },
        iarcDirect: {
          enabled: true,
          urlTemplate: 'https://v.iarc.top/?type=url&id={{id}}#.mp3'
        },
        metingRedirect: {
          enabled: false,
          endpointTemplate: ''
        },
        neteaseOuter: {
          enabled: true,
          urlTemplate: 'https://music.163.com/song/media/outer/url?id={{id}}.mp3'
        }
      }
    }
  });

  assert.deepEqual(config.playUrlProviders, ['customTemplate', 'iarcDirect', 'neteaseOuter'], 'provider order should be preserved');

  const customResolved = await resolvePlayUrl('12345', {
    music: {
      playUrlProviders: ['customTemplate', 'iarcDirect', 'neteaseOuter'],
      providers: {
        customTemplate: {
          enabled: true,
          urlTemplate: 'https://media.example.com/song/{{id}}.mp3'
        },
        iarcDirect: {
          enabled: true,
          urlTemplate: 'https://v.iarc.top/?type=url&id={{id}}#.mp3'
        },
        neteaseOuter: {
          enabled: true,
          urlTemplate: 'https://music.163.com/song/media/outer/url?id={{id}}.mp3'
        }
      }
    }
  });

  assert.equal(customResolved.provider, 'customTemplate', 'custom template provider should win when enabled');
  assert.equal(customResolved.url, 'https://media.example.com/song/12345.mp3', 'custom template provider should interpolate id');

  const fallbackResolved = await resolvePlayUrl('67890', {
    music: {
      playUrlProviders: ['customTemplate', 'iarcDirect', 'neteaseOuter'],
      providers: {
        customTemplate: {
          enabled: false,
          urlTemplate: ''
        },
        iarcDirect: {
          enabled: true,
          urlTemplate: 'https://v.iarc.top/?type=url&id={{id}}#.mp3'
        },
        neteaseOuter: {
          enabled: true,
          urlTemplate: 'https://music.163.com/song/media/outer/url?id={{id}}.mp3'
        }
      }
    }
  });

  assert.equal(fallbackResolved.provider, 'iarcDirect', 'iarcDirect provider should be used before netease outer fallback');
  assert.equal(fallbackResolved.url, 'https://v.iarc.top/?type=url&id=67890#.mp3', 'iarcDirect provider should interpolate id');

  console.log('✅ PASS: music provider regression');
}

main().catch((error) => {
  console.error('❌ FAIL: music provider regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
