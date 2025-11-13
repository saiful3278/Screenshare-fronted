import { useState, useRef, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

export default function App() {
  const [isSharing, setIsSharing] = useState(false);
  const [isViewing, setIsViewing] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [status, setStatus] = useState<string>('idle');
  const [availableCount, setAvailableCount] = useState<number>(0);
  const [availableRooms, setAvailableRooms] = useState<string[]>([]);
  const [canShare, setCanShare] = useState<boolean>(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
    const secure = (window as any).isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const topLevel = window.top === window.self;
    const api = !!(navigator.mediaDevices && (navigator.mediaDevices as any).getDisplayMedia);
    setCanShare(secure && topLevel && api && !isMobile);

    const params = new URLSearchParams(window.location.search);
    const initialRoom = params.get('room');
    if (initialRoom) setRoomId(initialRoom);

    const socketInstance = io(import.meta.env.VITE_SERVER_URL, {
      transports: ['websocket', 'polling'],
      timeout: 20000,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      path: '/socket.io',
      forceNew: true,
      autoConnect: true
    });
    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      console.log('Connected to server');
      setStatus('connected-to-signaling');
      socketInstance.emit('get-available');
      socketInstance.emit('get-rooms');
    });

    socketInstance.on('connect_error', (err) => {
      console.error('Socket connect error', err);
      if (!socketInstance.connected) setStatus('disconnected');
    });


    socketInstance.on('connect_timeout', () => {
      console.error('Socket connect timeout');
      setStatus('disconnected');
    });

    socketInstance.on('reconnect_attempt', () => {
      setStatus('negotiating');
    });

    socketInstance.on('reconnect_error', (err) => {
      console.error('Socket reconnect error', err);
    });

    socketInstance.on('reconnect_failed', () => {
      setStatus('disconnected');
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('Socket disconnected', reason);
      setStatus('disconnected');
    });

    socketInstance.on('reconnect', (attempt) => {
      console.log('Socket reconnected', attempt);
      setStatus('connected-to-signaling');
      socketInstance.emit('get-available');
      socketInstance.emit('get-rooms');
    });

    socketInstance.on('room-created', (data: { roomId: string }) => {
      setRoomId(data.roomId);
      console.log('Room created:', data.roomId);
      const url = new URL(window.location.href);
      url.searchParams.set('room', data.roomId);
      window.history.replaceState(null, '', url.toString());
      socketInstance.emit('get-available');
      socketInstance.emit('get-rooms');
    });

    socketInstance.on('available-count', (data: { count: number }) => {
      if (typeof data?.count === 'number') setAvailableCount(data.count);
    });

    socketInstance.on('available-rooms', (data: { rooms: string[] }) => {
      if (Array.isArray(data?.rooms)) setAvailableRooms(data.rooms);
    });

    socketInstance.on('viewer-joined', async () => {
      console.log('Viewer joined');
      setStatus('negotiating');
      if (peerConnectionRef.current) {
        const offer = await peerConnectionRef.current.createOffer();
        await peerConnectionRef.current.setLocalDescription(offer);
        socketInstance.emit('offer', { offer, roomId });
      }
    });

    socketInstance.on('offer', async (data: { offer: RTCSessionDescriptionInit }) => {
      console.log('Received offer');
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(data.offer);
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        socketInstance.emit('answer', { answer, roomId });
      }
    });

    socketInstance.on('answer', async (data: { answer: RTCSessionDescriptionInit }) => {
      console.log('Received answer');
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(data.answer);
        setStatus('media-connected');
      }
    });

    socketInstance.on('ice-candidate', async (data: { candidate: RTCIceCandidateInit }) => {
      console.log('Received ICE candidate');
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(data.candidate);
      }
    });

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const retrySignaling = () => {
    if (socket) {
      setStatus('negotiating');
      socket.connect();
    }
  };

  const fetchRooms = () => {
    socket?.emit('get-rooms');
  };

  const joinSelectedRoom = (id: string) => {
    setRoomId(id);
    setIsViewing(true);
    setStatus('negotiating');
    socket?.emit('join-view', { roomId: id });
  };

  const createPeerConnection = (isInitiator: boolean) => {
    const peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', { candidate: event.candidate, roomId });
      }
    };

    if (!isInitiator) {
      peerConnection.ontrack = (event) => {
        console.log('Received remote stream');
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          // Attempt to play for mobile devices
          remoteVideoRef.current.play().catch(() => {});
          setStatus('media-connected');
        }
      };
    }

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      if (state === 'connected') setStatus('media-connected');
      if (state === 'disconnected' || state === 'failed') setStatus('disconnected');
      if (state === 'connecting') setStatus('negotiating');
    };

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      if (state === 'connected') setStatus('media-connected');
      if (state === 'checking') setStatus('negotiating');
      if (state === 'failed' || state === 'disconnected') setStatus('disconnected');
    };

    if (isInitiator) {
      peerConnection.onnegotiationneeded = async () => {
        try {
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          if (socket) {
            socket.emit('offer', { offer, roomId });
          }
        } catch {}
      };
    }

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  };

  const startSharing = async () => {
    try {
      const isTopLevel = window.top === window.self;
      const isSecure = (window as any).isSecureContext 
        || location.protocol === 'https:'
        || location.hostname === 'localhost'
        || location.hostname === '127.0.0.1';
      const hasAPI = !!(navigator.mediaDevices && (navigator.mediaDevices as any).getDisplayMedia);

      if (!isSecure) {
        console.error('Use HTTPS or localhost');
        return;
      }
      if (!isTopLevel) {
        console.error('Open in a browser tab');
        return;
      }
      if (!hasAPI) {
        console.error('Screen capture API unavailable');
        return;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

      localStreamRef.current = stream;
      setIsSharing(true);
      const peerConnection = createPeerConnection(true);
      
      stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });

      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };

      setStatus('sharing');
      socket?.emit('start-share');
      socket?.emit('get-available');
    } catch (error) {
      console.error('Error starting screen share:', error);
      setStatus('idle');
    }
  };

  useEffect(() => {
    if (isSharing && localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.onloadedmetadata = () => {
        localVideoRef.current?.play().catch(() => {});
      };
    }
  }, [isSharing]);

  const stopSharing = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setIsSharing(false);
    setStatus('idle');
    socket?.emit('stop-share');
    socket?.emit('get-available');
  };

  const startViewing = async () => {
    try {
      const peerConnection = createPeerConnection(false);
      setIsViewing(true);
      setStatus('negotiating');
      const params = new URLSearchParams(window.location.search);
      const initialRoom = params.get('room');
      if (initialRoom) {
        joinSelectedRoom(initialRoom);
      } else if (roomId) {
        socket?.emit('join-view', { roomId });
      } else {
        fetchRooms();
      }
    } catch (error) {
      console.error('Error starting viewing:', error);
      setStatus('idle');
    }
  };

  const stopViewing = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setIsViewing(false);
    setStatus('idle');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-4xl w-full">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
          Screen Share
        </h1>
        
        <div className="flex justify-center gap-4 mb-4">
          {!isSharing ? (
            <button
              onClick={startSharing}
              disabled={!canShare}
              className={`bg-blue-500 ${canShare ? 'hover:bg-blue-600' : 'opacity-50 cursor-not-allowed'} text-white font-semibold py-3 px-6 rounded-lg transition-colors`}
            >
              Share
            </button>
          ) : (
            <button
              onClick={stopSharing}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Stop Sharing
            </button>
          )}

          {!isViewing ? (
            <button
              onClick={startViewing}
              className="bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              View
            </button>
          ) : (
            <button
              onClick={stopViewing}
              className="bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Stop Viewing
            </button>
          )}
          <span className="inline-block px-3 py-1 rounded-full text-sm bg-gray-200 text-gray-700">
            Available: {availableCount}
          </span>
          {isViewing && (
            <button onClick={fetchRooms} className="ml-2 inline-block bg-gray-800 text-white text-sm px-3 py-1 rounded">
              Refresh Rooms
            </button>
          )}
        </div>

        <div className="text-center mb-6">
          <span className="inline-block px-3 py-1 rounded-full text-sm bg-gray-200 text-gray-700 mr-2">
            {status === 'idle' && 'Idle'}
            {status === 'connected-to-signaling' && 'Connected to signaling'}
            {status === 'sharing' && 'Sharing started'}
            {status === 'negotiating' && 'Negotiating connection'}
            {status === 'media-connected' && 'Streaming'}
            {status === 'disconnected' && 'Disconnected'}
          </span>
          <button onClick={retrySignaling} className="inline-block bg-gray-800 text-white text-sm px-3 py-1 rounded">
            Retry
          </button>
        </div>

        {roomId && (
          <div className="text-center mb-4">
            <p className="text-sm text-gray-600">Room ID: {roomId}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isSharing && (
            <div className="flex flex-col relative">
              <h3 className="text-lg font-semibold mb-2 text-center">Your Screen</h3>
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-64 bg-black rounded-lg"
              />
              <span className="absolute top-2 right-2 text-xs bg-blue-600 text-white px-2 py-1 rounded">Sharing</span>
            </div>
          )}

          {isViewing && status !== 'media-connected' && (
            <div className="flex flex-col">
              <h3 className="text-lg font-semibold mb-2 text-center">Available Rooms</h3>
              <div className="grid grid-cols-1 gap-2">
                {availableRooms.length === 0 && (
                  <div className="text-center text-sm text-gray-600">No active rooms</div>
                )}
                {availableRooms.map((r) => (
                  <button key={r} onClick={() => joinSelectedRoom(r)} className="border rounded px-3 py-2 text-left hover:bg-gray-100">
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isViewing && status === 'media-connected' && (
            <div className="flex flex-col">
              <h3 className="text-lg font-semibold mb-2 text-center">Remote Screen</h3>
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-64 bg-black rounded-lg"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
