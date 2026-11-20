'use client';

import { useSession } from '@safezone/web-ui';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { session } from './session';

export type RealtimeStatus = 'connected' | 'reconnecting' | 'offline';

interface RealtimeContextValue {
  socket: Socket | null;
  status: RealtimeStatus;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  socket: null,
  status: 'offline',
});

const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:4001';

/**
 * Authenticated Socket.IO connection for the signed-in estate shell.
 * Falls back gracefully to polling when the realtime gateway is unreachable.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const auth = useSession(session);
  const signedIn = auth.status === 'signed_in';
  const [status, setStatus] = useState<RealtimeStatus>('offline');
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setSocket(null);
      setStatus('offline');
      return;
    }

    const client = io(realtimeUrl, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 15_000,
      auth: (cb) => {
        void Promise.resolve(session.getAccessToken())
          .then((token) => cb({ token: token ?? '' }))
          .catch(() => cb({ token: '' }));
      },
    });

    client.on('connect', () => setStatus('connected'));
    client.on('disconnect', () => setStatus('reconnecting'));
    client.on('connect_error', () => setStatus('offline'));
    client.io.on('reconnect_attempt', () => setStatus('reconnecting'));

    setSocket(client);
    return () => {
      client.disconnect();
      setSocket(null);
      setStatus('offline');
    };
  }, [signedIn]);

  const value = useMemo(() => ({ socket, status }), [socket, status]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext).status;
}

/**
 * Joins a Socket.IO room when connected (and on every reconnect) and invokes `onEvent`
 * whenever `event` arrives. Leaves the room cleanly on unmount or room change.
 */
export function useRealtimeRoom(
  room: string | null,
  event: string,
  onEvent: (payload: unknown) => void,
): RealtimeStatus {
  const { socket, status } = useContext(RealtimeContext);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!socket || !room) return;

    const join = () => {
      socket.emit('room:join', { room });
    };
    const listener = (payload: unknown) => handlerRef.current(payload);

    if (socket.connected) join();
    socket.on('connect', join);
    socket.on(event, listener);

    return () => {
      socket.off('connect', join);
      socket.off(event, listener);
      if (socket.connected) socket.emit('room:leave', { room });
    };
  }, [socket, room, event]);

  return status;
}
