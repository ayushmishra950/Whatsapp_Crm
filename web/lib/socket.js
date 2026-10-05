"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { API_URL, tokens } from "./api";

let socket = null;
let socketToken = null;

export function getSocket() {
  const token = tokens.get();
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  socket?.disconnect();
  socketToken = token;
  socket = io(API_URL, { auth: { token }, transports: ["websocket"] });
  return socket;
}

// Subscribe to a socket event; handler can change between renders
export function useSocketEvent(event, handler) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const fn = (payload) => ref.current(payload);
    s.on(event, fn);
    return () => s.off(event, fn);
  }, [event]);
}
