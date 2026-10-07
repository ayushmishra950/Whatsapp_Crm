export const API_URL = process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" && typeof window !== "undefined" ? window.location.origin : "http://localhost:4000");

const TOKEN_KEY = "crm_token";
const SUPER_TOKEN_KEY = "crm_super_token"; // kept while super admin impersonates a business

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {}
  },
};

export const tokens = {
  get: () => storage.get(TOKEN_KEY),
  set: (t) => storage.set(TOKEN_KEY, t),
  getSuper: () => storage.get(SUPER_TOKEN_KEY),
  setSuper: (t) => storage.set(SUPER_TOKEN_KEY, t),
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = "GET", body, query, form } = {}) {
  const url = new URL(`/api${path}`, API_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const headers = {};
  const token = tokens.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !form) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Please check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/login")) {
      tokens.set(null);
      window.location.href = "/login";
    }
    throw new ApiError(res.status, data.error || "Request failed", data.details);
  }
  return data;
}

// Authenticated binary fetch (e.g. inbound WhatsApp media) -> object URL
export async function fetchBlobUrl(path) {
  const res = await fetch(new URL(`/api${path}`, API_URL), { headers: { Authorization: `Bearer ${tokens.get()}` } });
  if (!res.ok) throw new Error("Media not available");
  return URL.createObjectURL(await res.blob());
}

// Authenticated file download (e.g. Excel export) -> saves it in the browser
export async function downloadFile(path, query, fallbackName = "download") {
  const url = new URL(`/api${path}`, API_URL);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tokens.get()}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error || "Download failed");
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
