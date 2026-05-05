# MEMORY.md - Curated Notes

- `workflow.prompt-profile` now reads prompt files directly and exposes `memoryText` / `memoryEntries` from the active prompt.
- `workflow.persona-memory` persists prompt-level long-term memory, rewrites `prompt/*.md` with `<<<IIC_PERSONA_MEMORY` blocks, and records only after successful bot replies.
- v0.3.2 memory writeback was implemented and verified with `node tests/run.js` on 2026-04-17.
- v0.3.2 short-term context iteration now keeps both room-level and global shared context, with source metadata preserved and default `messageMemory.recentMessageCount` raised to 30.
- v0.3.3 requirement 2 shifted the active provider path to HTTP-only: `OpenAICompatibleProvider` now fails closed on empty/refusal/tool-call responses, named HTTP providers outrank same-name `openclaw` bridge registrations, and the full test suite passed on 2026-04-30.
- HTTP provider config now has a unified `thinking` switch (`off`/`on`/`auto`) that maps to the compatibility-layer `enable_thinking` body field; `enable_thinking` remains supported as a lower-level extra body override.
- v0.3.3 proactive topic engagement must stay a separate registered service; do not alias `active-mode` onto `proactive.topic-engagement` or it will hide the real plugin service.
- `config/app.json` now defaults `providers.named.faramita.thinking` to `off`, matching the load test and the HTTP provider contract.
- v0.3.3 主动介入链路已收口：`active-mode` 是权威状态源，旧的 `proactive.topic-engagement` 在 workflow/hybrid 下只作兼容壳，不再独立发言。
