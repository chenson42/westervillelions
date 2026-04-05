"use client";

import { useState, useRef } from "react";
import ReactCrop, { type Crop, type PixelCrop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

// Matches the events page display ratio: w-full h-64 (256px) at max-w-4xl (896px) ≈ 3.5:1
const ASPECT = 7 / 2;
const OUTPUT_WIDTH = 1400;
const OUTPUT_HEIGHT = 400;

function cropImageToDataUrl(image: HTMLImageElement, crop: PixelCrop): string {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;

  const ctx = canvas.getContext("2d")!;
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;

  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    OUTPUT_WIDTH,
    OUTPUT_HEIGHT
  );

  return canvas.toDataURL("image/jpeg", 0.82);
}

function centerAspectCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 90 }, ASPECT, width, height),
    width,
    height
  );
}

export function ImageCropper({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (dataUrl: string | null) => void;
}) {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const imgRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-selected
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = () => {
      setSrcUrl(reader.result as string);
      setCrop(undefined);
      setCompletedCrop(undefined);
    };
    reader.readAsDataURL(file);
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    // Use displayed dimensions — ReactCrop operates in display-pixel space
    const displayW = img.width || img.naturalWidth;
    const displayH = img.height || img.naturalHeight;
    const percentCrop = centerAspectCrop(displayW, displayH);
    setCrop(percentCrop);
    // Pre-initialize completedCrop so Apply works without requiring a manual drag
    setCompletedCrop({
      unit: "px",
      x: Math.round((percentCrop.x / 100) * displayW),
      y: Math.round((percentCrop.y / 100) * displayH),
      width: Math.round((percentCrop.width / 100) * displayW),
      height: Math.round((percentCrop.height / 100) * displayH),
    });
  }

  function handleApply() {
    if (!imgRef.current || !completedCrop) return;
    const dataUrl = cropImageToDataUrl(imgRef.current, completedCrop);
    onChange(dataUrl);
    setSrcUrl(null);
  }

  // Cropping state
  if (srcUrl) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Drag to adjust the crop area, then click Apply.</p>
        <div className="overflow-auto max-h-[500px] bg-gray-900 rounded-lg flex justify-center p-2">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={ASPECT}
            minWidth={100}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={srcUrl}
              alt="Upload preview"
              onLoad={handleImageLoad}
              style={{ maxHeight: "460px", display: "block" }}
            />
          </ReactCrop>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleApply}
            disabled={!completedCrop?.width}
            className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark disabled:opacity-50"
          >
            Apply Crop
          </button>
          <button
            type="button"
            onClick={() => setSrcUrl(null)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Has existing image
  if (value) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-gray-500">Preview — matches how it appears on the events page</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="rounded-lg overflow-hidden border border-gray-200 shadow-sm">
          <img
            src={value}
            alt="Event image"
            className="w-full aspect-[7/2] object-cover"
          />
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Change Image
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>
    );
  }

  // Empty state
  return (
    <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-lions-blue hover:bg-blue-50 transition-colors">
      <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span className="text-sm text-gray-500">Click to upload an image</span>
      <span className="text-xs text-gray-400 mt-1">Will be cropped to 16:9</span>
      <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </label>
  );
}
