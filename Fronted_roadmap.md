# Frontend (React) Roadmap

## Goal
Build a minimal UI with two buttons:
- "Share" → Start screen sharing (WebRTC)
- "View" → Watch the live shared screen
No login/auth, minimal design, basic security.

## Steps

1. **Setup**
   - Create React app (Vite or CRA)
   - Install: `npm install socket.io-client`

2. **UI**
   - Two buttons: [Share] and [View]
   - Use Tailwind or simple CSS

3. **Share Button Flow**
   - On click → call `navigator.mediaDevices.getDisplayMedia()`
   - Connect to backend via Socket.IO
   - Emit "start-share" event
   - Create WebRTC peer connection
   - Send offer → backend → viewers
   - Display local preview

4. **View Button Flow**
   - Connect to backend via Socket.IO
   - Emit "join-view" event
   - Receive offer/answer/ICE from sharer
   - Display remote stream in `<video>`

5. **Security (Minimal)**
   - Generate random room IDs on backend
   - Use HTTPS + WSS (required for screen capture)
   - Limit message types accepted from socket

6. **Testing**
   - Open two tabs: one Share, one View
   - Verify real-time screen shows instantly
