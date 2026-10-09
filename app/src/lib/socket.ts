import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, tokens } from './api';

let socket: Socket | null = null;
let socketToken: string | null = null;

/** Live updates (new messages, tasks…) for the logged-in business */
export function getSocket() {
  const token = tokens.get();
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  socket?.disconnect();
  socketToken = token;
  socket = io(API_URL, { auth: { token }, transports: ['websocket'] });
  return socket;
}

/** Login / logout / business switch: the next getSocket() connects with the new token */
export function resetSocket() {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}

/** Subscribe to a socket event; the handler may change between renders */
export function useSocketEvent<T = any>(event: string, handler: (payload: T) => void, key?: unknown) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const fn = (payload: T) => ref.current(payload);
    s.on(event, fn);
    return () => {
      s.off(event, fn);
    };
  }, [event, key]);
}
