"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { LandingState } from "./landing-state";

interface PreviewStateValue {
  landingState: LandingState;
  setLandingState: (s: LandingState) => void;
}

const PreviewStateContext = createContext<PreviewStateValue | null>(null);

// In-memory only: survives soft navigation between preview screens, resets on
// a hard reload. Never read from or written to the URL, storage or cookies.
export function PreviewStateProvider({ children }: { children: React.ReactNode }) {
  const [landingState, setLandingState] = useState<LandingState>("open");
  const value = useMemo(() => ({ landingState, setLandingState }), [landingState]);
  return <PreviewStateContext.Provider value={value}>{children}</PreviewStateContext.Provider>;
}

export function usePreviewState(): PreviewStateValue {
  const ctx = useContext(PreviewStateContext);
  if (!ctx) throw new Error("usePreviewState must be used inside PreviewStateProvider");
  return ctx;
}

export function useLandingState(): LandingState {
  return usePreviewState().landingState;
}
