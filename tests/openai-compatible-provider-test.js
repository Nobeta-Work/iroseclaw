/**
 * OpenAI-compatible provider regression test
 */

const assert = require('assert');
const { OpenAICompatibleProvider } = require('../src/ai/providers/openai-compatible-provider');

async function testChatCompletionRequestShape() {
  let seenUrl = '';
  let seenOptions = null;
  const provider = new OpenAICompatibleProvider({
    provider: 'analysis-http',
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'test-key',
    model: 'gpt-test',
    extraBody: {
      enable_thinking: false
    },
    fetchImpl: async (url, options) => {
      seenUrl = url;
      seenOptions = options;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async text() {
          return JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"summary":"ok"}'
                }
              }
            ]
          });
        }
      };
    }
  });

  const result = await provider.complete({
    systemPrompt: 'system',
    userPrompt: 'user',
    json: true,
    maxTokens: 256
  });

  const body = JSON.parse(seenOptions.body);
  assert.equal(seenUrl, 'https://api.example.com/v1/chat/completions', 'provider should target chat completions endpoint by default');
  assert.equal(seenOptions.method, 'POST', 'provider should use POST');
  assert.equal(seenOptions.headers.Authorization, 'Bearer test-key', 'provider should send bearer token');
  assert.equal(body.model, 'gpt-test', 'provider should send configured model');
  assert.deepEqual(body.response_format, { type: 'json_object' }, 'provider should request JSON object when json=true');
  assert.equal(body.max_tokens, 256, 'provider should pass max_tokens when provided');
  assert.equal(body.enable_thinking, false, 'provider should merge configured extra body fields');
  assert.equal(Array.isArray(body.messages), true, 'provider should send messages array');
  assert.equal(body.messages[0].role, 'system', 'provider should include system prompt');
  assert.equal(body.messages[1].role, 'user', 'provider should include user prompt');
  assert.equal(result.ok, true, 'provider should succeed');
  assert.equal(result.text, '{"summary":"ok"}', 'provider should extract assistant text');
}

async function testErrorResponseSurface() {
  const provider = new OpenAICompatibleProvider({
    provider: 'analysis-http',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-test',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      async text() {
        return JSON.stringify({
          error: {
            message: 'invalid request'
          }
        });
      }
    })
  });

  const result = await provider.complete({
    message: 'hello'
  });

  assert.equal(result.ok, false, 'provider should expose non-2xx responses');
  assert.equal(result.error.includes('HTTP 400'), true, 'provider should include HTTP status in error');
  assert.equal(result.error.includes('invalid request'), true, 'provider should include parsed API error message');
}

async function main() {
  await testChatCompletionRequestShape();
  await testErrorResponseSurface();
  console.log('✅ PASS: openai-compatible provider regression');
}

main().catch((error) => {
  console.error('❌ FAIL: openai-compatible provider regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
