import dgram from 'node:dgram';

export interface UdpPeer {
  address: string;
  port: number;
  room: string;
  peerId?: string;
  lastSeen: number;
  isSpeaking: boolean;
  lastSpeaking: number;
}

function computeRms(buffer: Buffer): number {
  if (buffer.length < 8) return 0;
  let sum = 0;
  const count = Math.floor(buffer.length / 2);
  for (let i = 0; i < buffer.length - 1; i += 2) {
    const sample = buffer.readInt16LE(i);
    sum += sample * sample;
  }
  return Math.sqrt(sum / count);
}

export function createUdpAudioServer(
  port: number,
  onActivityChange?: (peerKey: string, isSpeaking: boolean) => void
) {
  const socket = dgram.createSocket('udp4');
  const activePeers = new Map<string, UdpPeer>();

  // Background timer to prune stale peers and prevent unbounded map growth (memory leak fix)
  const pruneInterval = setInterval(() => {
    const cutoff = Date.now() - 30000;
    for (const [peerKey, peer] of activePeers.entries()) {
      if (peer.lastSeen < cutoff) {
        if (peer.isSpeaking) {
          onActivityChange?.(peerKey, false);
        }
        activePeers.delete(peerKey);
      }
    }
  }, 15000);

  if (pruneInterval && typeof pruneInterval.unref === 'function') {
    pruneInterval.unref();
  }

  socket.on('message', (msg, rinfo) => {
    const key = `${rinfo.address}:${rinfo.port}`;
    let peer = activePeers.get(key);
    const now = Date.now();

    if (!peer) {
      const room = msg.length >= 4 ? msg.toString('utf8', 0, 4) : 'main';
      peer = {
        address: rinfo.address,
        port: rinfo.port,
        room,
        lastSeen: now,
        isSpeaking: false,
        lastSpeaking: 0,
      };
      activePeers.set(key, peer);
    } else {
      peer.lastSeen = now;
    }

    // Measure audio energy (SFU Voice Activity Detection)
    const energy = computeRms(msg);
    const speakingNow = energy > 250;

    if (speakingNow) {
      peer.lastSpeaking = now;
      if (!peer.isSpeaking) {
        peer.isSpeaking = true;
        onActivityChange?.(key, true);
      }
    } else if (peer.isSpeaking && now - peer.lastSpeaking > 400) {
      peer.isSpeaking = false;
      onActivityChange?.(key, false);
    }

    // Forward UDP audio payload to all other active peers in the room
    for (const [otherKey, otherPeer] of activePeers.entries()) {
      if (otherKey !== key && otherPeer.room === peer.room && now - otherPeer.lastSeen < 15000) {
        socket.send(msg, otherPeer.port, otherPeer.address);
      }
    }
  });

  socket.on('error', (err) => {
    console.error('[Uniflex SFU] UDP Server error:', err.message);
  });

  socket.on('close', () => {
    clearInterval(pruneInterval);
    activePeers.clear();
  });

  socket.on('listening', () => {
    const addr = socket.address();
    console.log(`[Uniflex SFU] UDP Media Router with VAD listening on ${addr.address}:${addr.port}`);
  });

  socket.bind(port, '0.0.0.0');
  return socket;
}
