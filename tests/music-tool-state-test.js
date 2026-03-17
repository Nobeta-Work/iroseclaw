/**
 * Music tool state/output regression test
 */

const assert = require('assert');
const { ToolRegistry } = require('../src/tools/registry');
const { OutputRuntime } = require('../src/runtime/output/runtime');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { WorkflowRuntime } = require('../src/runtime/workflow/runtime');
const { MemoryStateStore } = require('../src/runtime/state/memory-store');
const { createMusicPlayNeteaseTool } = require('../src/tools/builtins/music-play-netease');

async function main() {
  const toolRegistry = new ToolRegistry();
  const stateStore = new MemoryStateStore();
  const sent = [];

  toolRegistry.register(createMusicPlayNeteaseTool({
    playSongDetailed: async (_session, query) => ({
      ok: true,
      query,
      replyText: '已开始播放《测试歌曲》 - 测试歌手',
      songId: 'song-1',
      songName: '测试歌曲',
      artistName: '测试歌手',
      provider: 'mock-music',
      playUrlHost: 'media.example.com',
      usedMusicCard: true
    })
  }));

  const outputRuntime = new OutputRuntime({
    policyEngine: new PolicyEngine(),
    sender: async (operation) => {
      sent.push(operation.content.text);
      return { operationId: operation.operationId };
    }
  });

  const runtime = new WorkflowRuntime({
    planner: {
      async decideNextStep(input) {
        if ((input.workflow?.toolHistory || []).length === 0) {
          return {
            status: 'needs_tools',
            toolCalls: [
              {
                callId: 'call_music_1',
                name: 'music.play_netease',
                arguments: {
                  query: '测试歌曲'
                }
              }
            ]
          };
        }

        return {
          status: 'final',
          finalOutput: {
            mode: 'none',
            text: ''
          }
        };
      }
    },
    toolRegistry,
    outputRuntime,
    policyEngine: new PolicyEngine(),
    stateStore
  });

  const result = await runtime.run({
    trigger: {
      kind: 'message.mentioned',
      session: {
        platform: 'iirose',
        channelId: 'room-music',
        userId: 'u-music',
        username: 'MusicTester',
        messageId: 'm-music'
      },
      payload: {
        content: '点歌 测试歌曲'
      }
    },
    protocolRequest: {
      session: {
        platform: 'iirose',
        channelId: 'room-music',
        userId: 'u-music',
        username: 'MusicTester',
        messageId: 'm-music'
      }
    },
    context: {
      userId: 'u-music',
      username: 'MusicTester',
      session: {
        channelId: 'room-music',
        userId: 'u-music',
        username: 'MusicTester'
      }
    }
  });

  assert.equal(result.decision.status, 'final', 'music workflow should finish');
  assert.equal(sent.length, 1, 'music tool should emit exactly one output through ToolResult.outputs');
  assert.equal(sent[0], '已开始播放《测试歌曲》 - 测试歌手', 'music tool should emit structured output text');
  assert.equal(result.outputResults.length, 1, 'workflow result should expose emitted music output');

  const roomState = await stateStore.get('room', 'room-music');
  const userState = await stateStore.get('user', 'u-music');
  assert.equal(roomState.currentSong.title, '测试歌曲', 'music tool should persist current room song state');
  assert.equal(roomState.currentSong.provider, 'mock-music', 'room state should persist provider metadata');
  assert.equal(roomState.currentSong.requestedBy.userId, 'u-music', 'room state should persist requester info');
  assert.equal(userState.lastPlayedSong.title, '测试歌曲', 'music tool should persist user lastPlayedSong state');

  console.log('✅ PASS: music tool state regression');
}

main().catch((error) => {
  console.error('❌ FAIL: music tool state regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
