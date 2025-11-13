import { useState, useRef, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

export default function App() {
  const [isSharing, setIsSharing] = useState(false);
  const [isViewing, setIsViewing] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomId, setRoomId] = useState<string>('');
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
    });

    socketInstance.on('room-created', (data: { roomId: string }) => {
      setRoomId(data.roomId);
      console.log('Room created:', data.roomId);
    });

    socketInstance.on('viewer-joined', async () => {
      console.log('Viewer joined');
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
        }
      };
    }

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  };

  const startSharing = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const peerConnection = createPeerConnection(true);
      
      stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });

      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };

      setIsSharing(true);
      socket?.emit('start-share');
    } catch (error) {
      console.error('Error starting screen share:', error);
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
    socket?.emit('stop-share');
  };

  const startViewing = async () => {
    try {
      const peerConnection = createPeerConnection(false);
      setIsViewing(true);
      socket?.emit('join-view');
    } catch (error) {
      console.error('Error starting viewing:', error);
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
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-4xl w-full">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
          Screen Share
        </h1>
        
        <div className="flex justify-center gap-4 mb-8">
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
                className="w-full h-64 bg-black rounded-lg"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}