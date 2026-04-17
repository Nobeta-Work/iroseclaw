# MEMORY.md - Curated Notes

- `workflow.prompt-profile` now reads prompt files directly and exposes `memoryText` / `memoryEntries` from the active prompt.
- `workflow.persona-memory` persists prompt-level long-term memory, rewrites `prompt/*.md` with `<<<IIC_PERSONA_MEMORY` blocks, and records only after successful bot replies.
- v0.3.2 memory writeback was implemented and verified with `node tests/run.js` on 2026-04-17.
- v0.3.2 short-term context iteration now keeps both room-level and global shared context, with source metadata preserved and default `messageMemory.recentMessageCount` raised to 30.
