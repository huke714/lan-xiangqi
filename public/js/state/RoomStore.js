// 房间与观战者列表缓存
const RoomStore = (() => {
  let rooms = [];
  let listener = null;

  function set(roomsData) {
    rooms = Array.isArray(roomsData) ? roomsData.slice() : [];
    if (listener) listener(rooms);
  }

  function getAll() {
    return rooms.slice();
  }

  function onChange(fn) {
    listener = fn;
  }

  function clear() {
    rooms = [];
  }

  return { set, getAll, onChange, clear };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RoomStore;
}
