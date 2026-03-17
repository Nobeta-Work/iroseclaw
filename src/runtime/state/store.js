/**
 * Base state store
 * 统一 workflow/session/room/user 四类状态读写接口。
 */

class StateStore {
  async get() {
    throw new Error('StateStore.get() must be implemented by subclasses.');
  }

  async set() {
    throw new Error('StateStore.set() must be implemented by subclasses.');
  }

  async patch() {
    throw new Error('StateStore.patch() must be implemented by subclasses.');
  }

  async delete() {
    throw new Error('StateStore.delete() must be implemented by subclasses.');
  }
}

module.exports = {
  StateStore
};
