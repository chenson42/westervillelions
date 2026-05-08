"use client";

import { useState } from "react";
import { SuggestionBoxDialog } from "./suggestion-box-dialog";

interface SuggestionBoxLauncherProps {
  className?: string;
  children: React.ReactNode;
}

export function SuggestionBoxLauncher({ className, children }: SuggestionBoxLauncherProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <SuggestionBoxDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
