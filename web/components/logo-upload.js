"use client";
/* eslint-disable @next/next/no-img-element -- logos are small data URLs, next/image would not optimise them */

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "./ui";

const MAX_SIDE = 256; // px; the sidebar shows it at 32-40 px, so this stays sharp on retina screens
const MAX_CHARS = 280 * 1024;

// Shrink any picked image to a small PNG (or WebP if PNG is too big) data URL
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let data = canvas.toDataURL("image/png");
      if (data.length > MAX_CHARS) data = canvas.toDataURL("image/webp", 0.85);
      if (data.length > MAX_CHARS) return reject(new Error("This image is too big, please choose a simpler logo"));
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image. Use a PNG or JPG file."));
    };
    img.src = url;
  });
}

/** Logo picker: preview + upload / remove. onSave(dataUrl | "") must return a promise. */
export function LogoUpload({ value, onSave, onError }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const save = async (v) => {
    setBusy(true);
    try {
      await onSave(v);
    } catch (err) {
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
        {value ? <img src={value} alt="Logo" className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-slate-300" />}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            await save(await shrink(file));
          } catch (err) {
            onError?.(err);
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => fileRef.current?.click()}>
          <ImagePlus className="h-3.5 w-3.5" /> {value ? "Change logo" : "Upload logo"}
        </Button>
        {value && (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => save("")} aria-label="Remove logo">
            <Trash2 className="h-3.5 w-3.5 text-red-500" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
