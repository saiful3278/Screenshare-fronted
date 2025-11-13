# FRONTEND.PROJECT.RULES

- Framework: React (Vite or CRA).
- Libraries: socket.io-client only.
- Components:
  - App.jsx: main UI (two buttons + video tag).
  - Share flow: uses getDisplayMedia + WebRTC peer + Socket.IO signaling.
  - View flow: connects as viewer and shows remote stream.
- Use Tailwind for styling (optional but preferred).
- HTTPS required for screen capture.
- No routing, no extra pages.
- Show errors via console only.
- Must auto-handle reconnect if Socket.IO disconnects.
