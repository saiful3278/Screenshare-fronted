import { useState, useRef, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

export default function App() {
  const [isSharing, setIsSharing] = useState(false);
  const [isViewing, setIsViewing] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [status, setStatus] = useState<string>('idle');
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const socketInstance = io('https://screenshare-backend.onrender.com', {
      transports: ['websocket']
    });
    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      console.log('Connected to server');
      setStatus('connected-to-signaling');
    });

    socketInstance.on('connect_error', (err) => {
      console.error('Socket connect error', err);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('Socket disconnected', reason);
      setStatus('disconnected');
    });

    socketInstance.on('reconnect', (attempt) => {
      console.log('Socket reconnected', attempt);
      setStatus('connected-to-signaling');
    });

    socketInstance.on('room-created', (data: { roomId: string }) => {
      setRoomId(data.roomId);
      console.log('Room created:', data.roomId);
    });

    socketInstance.on('viewer-joined', async () => {
      console.log('Viewer joined');
      setStatus('negotiating');
      if (localStreamRef.current && peerConnectionRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          if (localStreamRef.current && peerConnectionRef.current) {
            peerConnectionRef.current.addTrack(track, localStreamRef.current);
          }
        });

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
  }, [roomId]);

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

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  };

  const startSharing = async () => {
    try {
      const isTopLevel = window.top === window.self;
      const isSecure = (window as any).isSecureContext || location.hostname === 'localhost';
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
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.setAttribute('playsinline', 'true');
        // Some browsers require explicit play
        localVideoRef.current.play().catch(() => {});
      }

      const peerConnection = createPeerConnection(true);
      
      stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });

      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };

      setIsSharing(true);
      setStatus('sharing');
      socket?.emit('start-share');
    } catch (error) {
      console.error('Error starting screen share:', error);
      setStatus('idle');
    }
  };

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
  };

  const startViewing = async () => {
    try {
      const peerConnection = createPeerConnection(false);
      setIsViewing(true);
      setStatus('negotiating');
      socket?.emit('join-view');
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
              className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
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
        </div>

        <div className="text-center mb-6">
          <span className="inline-block px-3 py-1 rounded-full text-sm bg-gray-200 text-gray-700">
            {status === 'idle' && 'Idle'}
            {status === 'connected-to-signaling' && 'Connected to signaling'}
            {status === 'sharing' && 'Sharing started'}
            {status === 'negotiating' && 'Negotiating connection'}
            {status === 'media-connected' && 'Streaming'}
            {status === 'disconnected' && 'Disconnected'}
          </span>
        </div>

        {roomId && (
          <div className="text-center mb-4">
            <p className="text-sm text-gray-600">Room ID: {roomId}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isSharing && (
            <div className="flex flex-col">
              <h3 className="text-lg font-semibold mb-2 text-center">Your Screen</h3>
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-64 bg-black rounded-lg"
              />
            </div>
          )}

          {isViewing && (
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
