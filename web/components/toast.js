"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, XCircle, Info } from "lucide-react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((type, message) => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list, { id, type, message }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);

  const toast = {
    success: (m) => push("success", m),
    error: (m) => push("error", m?.message || m),
    info: (m) => push("info", m),
  };

  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-brand-600" />,
    error: <XCircle className="h-5 w-5 text-red-600" />,
    info: <Info className="h-5 w-5 text-sky-600" />,
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed right-4 bottom-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
            {icons[t.type]}
            <p className="flex-1 text-slate-700">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
