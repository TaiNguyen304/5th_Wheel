(function() {
  function getRoomId() {
    const urlParams = new URLSearchParams(window.location.search);
    let room = urlParams.get('roomid');
    if (!room) {
      room = localStorage.getItem('current_room_id') || '123456';
    }
    return room;
  }

  const roomId = getRoomId();
  const bc = new BroadcastChannel('wheel_room_' + roomId);
  const listeners = {};
  const processedMsgs = new Set();

  function handleIncoming(event, payload) {
    if (!payload) payload = {};
    if (payload._msgId) {
      if (processedMsgs.has(payload._msgId)) return;
      processedMsgs.add(payload._msgId);
      if (processedMsgs.size > 200) {
        const first = processedMsgs.values().next().value;
        processedMsgs.delete(first);
      }
    }

    if (listeners[event]) {
      listeners[event].forEach(fn => fn(payload));
    }
    if (listeners['*']) {
      listeners['*'].forEach(fn => fn(event, payload));
    }
  }

  // Listen to native BroadcastChannel
  bc.onmessage = (e) => {
    if (e.data && e.data.event) {
      handleIncoming(e.data.event, e.data.payload);
    }
  };

  // Listen to SSE fallback from server
  try {
    const sse = new EventSource('/api/events?roomid=' + encodeURIComponent(roomId));
    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data && data.event) {
          handleIncoming(data.event, data.payload);
        }
      } catch (err) {}
    };
  } catch (err) {}

  // Initial state fetch from server
  function fetchServerState() {
    fetch('/api/state?roomid=' + encodeURIComponent(roomId))
      .then(res => res.json())
      .then(state => {
        if (state) {
          handleIncoming('full_sync_state', state);
        }
      })
      .catch(() => {});
  }

  window.BridgeSync = {
    getRoomId: function() {
      return roomId;
    },
    send: function(event, payload = {}) {
      if (!payload._msgId) {
        payload._msgId = Math.random().toString(36).substring(2, 11) + Date.now();
      }
      payload.roomId = roomId;

      // Mark locally processed so sender doesn't re-trigger from SSE echo
      processedMsgs.add(payload._msgId);

      // Send via BroadcastChannel
      try {
        bc.postMessage({ event, payload, roomId });
      } catch (e) {}

      // Send via Server Broadcast
      try {
        fetch('/api/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, payload, roomId })
        }).catch(() => {});
      } catch (e) {}
    },
    on: function(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    isProcessed: function(msgId) {
      if (!msgId) return false;
      if (processedMsgs.has(msgId)) return true;
      processedMsgs.add(msgId);
      return false;
    },
    fetchState: fetchServerState
  };

  // Automatically fetch state after initialization
  setTimeout(fetchServerState, 100);
})();


