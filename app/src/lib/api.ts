import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Backend URL. Set EXPO_PUBLIC_API_URL in app/.env (e.g. https://your-api.onrender.com).
 * Default: the API on this computer (the iOS simulator can reach "localhost"; the Android emulator uses 10.0.2.2).
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000')).replace(/\/$/, '');

const TOKEN_KEY = 'crm_token';
let memToken: string | null = null;
let loaded = false;
let onUnauthorized: (() => void) | null = null;

export const tokens = {
  async load() {
    if (loaded) return memToken;
    try {
      memToken = Platform.OS === 'web' ? globalThis.localStorage?.getItem(TOKEN_KEY) ?? null : await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      memToken = null;
    }
    loaded = true;
    return memToken;
  },
  get: () => memToken,
  async set(token: string | null) {
    memToken = token;
    loaded = true;
    try {
      if (Platform.OS === 'web') {
        if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
        else globalThis.localStorage?.removeItem(TOKEN_KEY);
      } else if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // keeps working for this session even if the phone's keychain is unavailable
    }
  },
};

/** Super Admin's own token, kept while they view a business as its admin */
const SUPER_KEY = 'crm_super_token';
export const superToken = {
  async get() {
    try {
      return Platform.OS === 'web' ? globalThis.localStorage?.getItem(SUPER_KEY) ?? null : await SecureStore.getItemAsync(SUPER_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string | null) {
    try {
      if (Platform.OS === 'web') {
        if (token) globalThis.localStorage?.setItem(SUPER_KEY, token);
        else globalThis.localStorage?.removeItem(SUPER_KEY);
      } else if (token) await SecureStore.setItemAsync(SUPER_KEY, token);
      else await SecureStore.deleteItemAsync(SUPER_KEY);
    } catch {
      // ignore
    }
  },
};

/** Called when the server says the session is over (401): the auth provider logs out */
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;
export type ApiOptions = { method?: string; body?: unknown; query?: Query; form?: FormData };

export async function api<T = any>(path: string, { method = 'GET', body, query, form }: ApiOptions = {}): Promise<T> {
  let url = `${API_URL}/api${path}`;
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
  }
  const headers: Record<string, string> = {};
  const token = tokens.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch (err) {
    // While developing, show the real reason (a bad request body fails here too, not only a lost connection)
    if (__DEV__) console.warn('[api]', method, path, err);
    throw new ApiError(0, `Cannot reach the server. Check your internet and try again.${__DEV__ && err instanceof Error ? ` (${err.message})` : ''}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized?.();
    throw new ApiError(res.status, (data as any).error || 'Request failed', (data as any).details);
  }
  return data as T;
}

/** Message of any error, for toasts */
export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err || 'Something went wrong'));
