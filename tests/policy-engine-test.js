/**
 * Policy engine regression test
 */

const assert = require('assert');
const { PolicyEngine } = require('../src/runtime/policy/engine');
const { createRuntimeConfigPolicyRule } = require('../src/runtime/policy/rules/runtime-config');

async function main() {
  const config = {
    admins: ['admin_uid'],
    permissions: {
      default: {
        allowedActions: ['chat', 'help', 'music'],
        blockedActions: ['message.route']
      },
      admin: {
        allowedActions: ['chat', 'help', 'music', 'message.route', 'admin', 'system', 'config'],
        blockedActions: []
      }
    }
  };

  const policyEngine = new PolicyEngine({
    allowCrossSessionSend: true,
    allowHighRiskTools: true
  });
  policyEngine.registerRule(createRuntimeConfigPolicyRule(config));

  const helpDecision = await policyEngine.evaluateToolCall(
    { userId: 'u1' },
    { name: 'help.show' },
    {
      name: 'help.show',
      permission: ['help'],
      riskLevel: 'low'
    }
  );

  const routeDecision = await policyEngine.evaluateToolCall(
    { userId: 'u1' },
    { name: 'message.route' },
    {
      name: 'message.route',
      permission: ['message.route'],
      riskLevel: 'high'
    }
  );

  const adminRouteDecision = await policyEngine.evaluateToolCall(
    { userId: 'admin_uid' },
    { name: 'message.route' },
    {
      name: 'message.route',
      permission: ['message.route'],
      riskLevel: 'high'
    }
  );

  const replyDecision = await policyEngine.evaluateOutputOperation(
    { userId: 'u1' },
    {
      kind: 'reply.current',
      target: {
        scope: 'current-session'
      }
    }
  );

  assert.equal(helpDecision.allowed, true, 'help tool should be allowed for default users');
  assert.equal(routeDecision.allowed, false, 'message.route should be denied for default users');
  assert.equal(adminRouteDecision.allowed, true, 'message.route should be allowed for admins');
  assert.equal(replyDecision.allowed, true, 'reply.current output should be allowed for chat users');

  console.log('✅ PASS: policy engine regression');
}

main().catch((error) => {
  console.error('❌ FAIL: policy engine regression');
  console.error(error.stack || error.message);
  process.exit(1);
});
