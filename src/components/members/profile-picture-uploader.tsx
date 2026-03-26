"use client";

import { useState, useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { ShadowAvatar } from "./shadow-avatar";

export interface ProfilePictureUploaderProps {
  currentPhotoUrl: string | null;
  memberName: string;
  onSave: (dataUri: string) => Promise<void>;
  onRemove: () => Promise<void>;
  disabled?: boolean;
}

function centerSquareCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: "%", width: 90 }, 1, width, height),
    width,
    height
  );
}

function cropToDataUri(image: HTMLImageElement, crop: PixelCrop): string {
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 300;
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
    300,
    300
  );

  return canvas.toDataURL("image/jpeg", 0.82);
}

export function ProfilePictureUploader({
  currentPhotoUrl,
  memberName,
  onSave,
  onRemove,
  disabled = false,
}: ProfilePictureUploaderProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset so the same file can be re-selected later
      e.target.value = "";

      const reader = new FileReader();
      reader.onload = () => {
        setSrcUrl(reader.result as string);
        setCrop(undefined);
        setCompletedCrop(undefined);
        setDialogOpen(true);
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget;
      setCrop(centerSquareCrop(naturalWidth, naturalHeight));
    },
    []
  );

  const handleApplyAndSave = useCallback(async () => {
    if (!imgRef.current || !completedCrop?.width) return;
    const dataUri = cropToDataUri(imgRef.current, completedCrop);
    setSaving(true);
    try {
      await onSave(dataUri);
      setDialogOpen(false);
      setSrcUrl(null);
    } finally {
      setSaving(false);
    }
  }, [completedCrop, onSave]);

  const handleCancel = useCallback(() => {
    setDialogOpen(false);
    setSrcUrl(null);
    setCrop(undefined);
    setCompletedCrop(undefined);
  }, []);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  }, [onRemove]);

  const isLoading = saving || removing;

  return (
    <div className="flex items-center gap-5">
      {/* Avatar circle */}
      <div className="relative w-24 h-24 rounded-full overflow-hidden flex-shrink-0 border-2 border-gray-200">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-full">
            <svg
              className="animate-spin h-6 w-6 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-label="Loading"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          </div>
        )}
        {currentPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentPhotoUrl}
            alt={`Profile photo of ${memberName}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <ShadowAvatar />
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={disabled || isLoading}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark focus:ring-2 focus:ring-lions-blue focus:outline-none disabled:opacity-50 min-h-[44px]"
        >
          Change photo
        </button>
        {currentPhotoUrl && (
          <button
            type="button"
            disabled={disabled || isLoading}
            onClick={handleRemove}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:ring-2 focus:ring-lions-blue focus:outline-none disabled:opacity-50 min-h-[44px]"
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          aria-label="Upload profile photo"
        />
      </div>

      {/* Crop dialog */}
      <Dialog.Root open={dialogOpen} onOpenChange={(open) => { if (!open) handleCancel(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto focus:outline-none">
            <Dialog.Title className="text-lg font-semibold text-gray-900 mb-1">
              Crop photo
            </Dialog.Title>
            <Dialog.Description className="text-sm text-gray-500 mb-4">
              Drag to adjust the crop area, then click &ldquo;Apply &amp; Save&rdquo;.
            </Dialog.Description>

            {srcUrl && (
              <div className="overflow-auto max-h-[400px] bg-gray-900 rounded-lg flex justify-center p-2 mb-4">
                <ReactCrop
                  crop={crop}
                  onChange={(c) => setCrop(c)}
                  onComplete={(c) => setCompletedCrop(c)}
                  aspect={1}
                  minWidth={50}
                  circularCrop
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imgRef}
                    src={srcUrl}
                    alt="Crop preview"
                    onLoad={handleImageLoad}
                    style={{ maxHeight: "360px", display: "block" }}
                  />
                </ReactCrop>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:ring-2 focus:ring-lions-blue focus:outline-none disabled:opacity-50 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyAndSave}
                disabled={saving || !completedCrop?.width}
                className="rounded-md bg-lions-blue px-4 py-2 text-sm font-semibold text-white hover:bg-lions-blue-dark focus:ring-2 focus:ring-lions-blue focus:outline-none disabled:opacity-50 min-h-[44px]"
              >
                {saving ? "Saving…" : "Apply & Save"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
