"use client";

import { useEffect, useRef, useState } from "react";
import type { FrameItem, FrameManifest, SessionKind } from "@/lib/santas-workshop/admin-contract";
import { ADMIN_API, callAdmin, formatEasternInstant } from "@/lib/santas-workshop/admin-ui";
import { buildIndexCsv } from "@/lib/santas-workshop/csv-index";
import { frameImageFileName } from "@/lib/santas-workshop/frame-names";
import { runSummarySentence, countsSentence, indexRowsFor, retakenSentence, WITHHELD_TEXT, type FrameOutcomeMap } from "@/lib/santas-workshop/frame-export-ui";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, EMPTY } from "./styles";
import { runFrameExport, type ReadyPart, type RunProgress } from "./frame-export-run";

type Phase = "idle" | "preparing" | "ready" | "exporting" | "finished";
interface PartLink {
  fileName: string;
  url: string;
  label: string;
  note: string | null;
}

export function FramesPanel({ sessionId, sessionKind, purged, year }: { sessionId: string; sessionKind: SessionKind; purged: boolean; year: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [manifest, setManifest] = useState<FrameManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [parts, setParts] = useState<PartLink[]>([]);
  const [outcomes, setOutcomes] = useState<FrameOutcomeMap>({});
  const [failed, setFailed] = useState<FrameItem[]>([]);
  const [csvUrl, setCsvUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlsRef = useRef<string[]>([]);
  const retryCount = useRef(0);
  const [runTarget, setRunTarget] = useState<FrameItem[]>([]);

  useEffect(() => {
    const urls = urlsRef;
    return () => {
      abortRef.current?.abort();
      for (const u of urls.current) URL.revokeObjectURL(u);
    };
  }, []);

  const track = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    urlsRef.current.push(url);
    return url;
  };

  async function prepare() {
    setPhase("preparing");
    setError(null);
    const res = await callAdmin<FrameManifest>(ADMIN_API.framesManifest(sessionId), { method: "POST" });
    if (!res.ok) {
      setError(res.failure.message);
      setPhase("idle");
      return;
    }
    setManifest(res.data);
    setParts([]);
    setOutcomes({});
    setFailed([]);
    setCsvUrl(null);
    retryCount.current = 0;
    setPhase("ready");
  }

  function refreshCombinedCsv(m: FrameManifest, o: FrameOutcomeMap) {
    const csv = buildIndexCsv(indexRowsFor(m.items.map((i) => ({ ...i, fileName: frameImageFileName(i) })), m.withheld, o));
    setCsvUrl(track(new Blob([csv], { type: "text/csv;charset=utf-8" })));
  }

  async function start(items: FrameItem[], previous: FrameOutcomeMap, retry: number | null) {
    if (!manifest) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setRunTarget(items);
    setPhase("exporting");
    setError(null);
    const onPart = (p: ReadyPart) =>
      setParts((cur) => [
        ...cur,
        {
          fileName: p.fileName,
          url: track(p.blob),
          label: retry === null ? `Download part ${p.number} of ${p.of}` : `Download retry zip ${retry}`,
          note:
            `${p.produced} frame${p.produced === 1 ? "" : "s"}` +
            (p.failed > 0 ? `, ${p.failed} failed (listed below)` : "") +
            (p.markError ? `. The app could not record this part as exported: ${p.markError}` : ""),
        },
      ]);
    try {
      const result = await runFrameExport(
        { sessionId, manifest, items, previous, practice: sessionKind === "practice", year, retry, subset: items.length < (manifest?.items.length ?? 0), signal: ctl.signal },
        { onProgress: setProgress, onPart },
      );
      setOutcomes(result.outcomes);
      setFailed(result.failedItems);
      refreshCombinedCsv(manifest, result.outcomes);
      setPhase("finished");
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith("The frame art") ? e.message : "The export stopped before it finished. Parts already listed are complete; prepare the export again to continue.");
      setPhase("ready");
    }
  }

  // The names a photo counter will see: a retaken frame never reuses an earlier upload's name.
  const items = (manifest?.items ?? []).map((i) => ({ ...i, fileName: frameImageFileName(i) }));
  const toRedo = items.filter((i) => i.exportStatus !== "current");
  const doneCount = runTarget.filter((i) => outcomes[i.stuffyId]?.produced === true).length;

  return (
    <div className="space-y-6">
      <p className="md:hidden rounded-2xl bg-amber-50 p-4 text-amber-900" role="note">Use a laptop for this step. Making the frames needs a bigger screen and some patience.</p>

      <section className={`${CARD} hidden md:block p-6`} aria-labelledby="frames-heading">
        <h2 id="frames-heading" className="text-lg font-semibold text-gray-900">Photo frames</h2>
        <p className="mt-1 text-sm text-gray-600">
          Each stuffy gets a 4x6 frame (portrait, 1200 x 1800 pixels at 300 dpi) holding its portrait, its name and a code that opens the day&rsquo;s photos.
          The frames are made in this browser and saved to your computer as zip files of pictures only, about 100 each. Upload them to the photo counter by hand.
          Your browser may ask permission to download several files.
        </p>
        {sessionKind === "practice" && <p className="mt-2 text-sm text-amber-800">Practice session: frames carry a &ldquo;PRACTICE, not for print&rdquo; band.</p>}

        {purged ? (
          <div className={`${EMPTY} mt-4`}>This session&rsquo;s photos have been removed, so there is nothing left to export.</div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={BTN_PRIMARY} onClick={() => void prepare()} disabled={phase === "preparing" || phase === "exporting"}>
              {phase === "preparing" ? "Preparing…" : manifest ? "Prepare export again" : "Prepare export"}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
      </section>

      {manifest && (
        <section className={`${CARD} hidden md:block p-6`} aria-labelledby="counts-heading" data-testid="frame-counts">
          <h2 id="counts-heading" className="text-lg font-semibold text-gray-900">Ready to export</h2>
          <p className="mt-1 text-gray-800" data-testid="frame-counts-sentence">{countsSentence(manifest.counts)}</p>
          <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div><dt className="text-sm text-gray-500">Frames to make</dt><dd className="text-3xl font-bold text-gray-900" data-testid="count-produce">{manifest.counts.withPortrait}</dd></div>
            <div><dt className="text-sm text-gray-500">Left out</dt><dd className="text-3xl font-bold text-gray-900" data-testid="count-withheld">{manifest.counts.withoutPortrait + manifest.counts.hidden}</dd></div>
            <div><dt className="text-sm text-gray-500">Retaken since last export</dt><dd className="text-3xl font-bold text-gray-900" data-testid="retaken-count">{manifest.counts.changedSinceExport}</dd></div>
            <div><dt className="text-sm text-gray-500">Last export</dt><dd className="text-base font-medium text-gray-900" data-testid="last-export">{manifest.lastExportAt ? `${formatEasternInstant(manifest.lastExportAt)} ET` : "never"}</dd></div>
          </dl>
          {retakenSentence(manifest.counts.changedSinceExport, manifest.lastExportAt) && (
            <p className="mt-3 text-sm text-amber-800">{retakenSentence(manifest.counts.changedSinceExport, manifest.lastExportAt)}</p>
          )}
          {manifest.withheld.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold text-gray-900">Left out of the zip</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-gray-700" data-testid="withheld-list">
                {manifest.withheld.map((w) => (
                  <li key={w.stuffyId}>{w.name}: {WITHHELD_TEXT[w.reason]}</li>
                ))}
              </ul>
            </div>
          )}
          {items.length === 0 ? (
            <div className={`${EMPTY} mt-4`}>No portraits have been taken yet, so there are no frames to make.</div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className={BTN_PRIMARY} onClick={() => void start(items, {}, null)} disabled={phase === "exporting" || phase === "preparing"}>
                Export frames
              </button>
              {toRedo.length > 0 && toRedo.length < items.length && (
                <button type="button" className={BTN_SECONDARY} onClick={() => void start(toRedo, {}, null)} disabled={phase === "exporting" || phase === "preparing"}>
                  Export only new and retaken ({toRedo.length})
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {(phase === "exporting" || phase === "finished" || parts.length > 0) && manifest && (
        <section className={`${CARD} hidden md:block p-6`} aria-labelledby="progress-heading">
          <h2 id="progress-heading" className="text-lg font-semibold text-gray-900">Export</h2>
          {phase === "exporting" && progress && (
            <div role="status" aria-live="polite" className="mt-2" data-testid="frame-progress">
              <p className="text-gray-800">
                Frame {Math.min(progress.done + 1, progress.total)} of {progress.total}, part {progress.part} of {progress.parts}
                {progress.currentName ? ` (${progress.currentName})` : ""}
              </p>
              <progress className="mt-2 h-3 w-full" max={progress.total} value={progress.done} aria-label="Frames made" />
              <button type="button" className={`${BTN_SECONDARY} mt-3`} onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
              <p className="mt-1 text-sm text-gray-600">Stopping keeps the parts already finished.</p>
            </div>
          )}

          {parts.length > 0 && (
            <ul className="mt-4 space-y-3" data-testid="part-list">
              {parts.map((p) => (
                <li key={p.fileName} className="flex flex-wrap items-center gap-3">
                  <a href={p.url} download={p.fileName} className={BTN_PRIMARY}>{p.label}</a>
                  <span className="text-sm text-gray-600 break-words">{p.fileName}: {p.note}</span>
                </li>
              ))}
            </ul>
          )}

          {phase === "finished" && (
            <div className="mt-4" data-testid="frame-summary">
              <p className="font-semibold text-gray-900">
                {runSummarySentence(doneCount, runTarget.length, failed.length)}
              </p>
              {failed.length > 0 && (
                <div className="mt-2">
                  <ul className="list-disc pl-5 text-sm text-red-800" data-testid="failed-list">
                    {failed.map((f) => {
                      const o = outcomes[f.stuffyId];
                      return <li key={f.stuffyId}>{f.name} ({f.fileName}): {o && !o.produced ? o.reason : "not made"}</li>;
                    })}
                  </ul>
                  <button
                    type="button"
                    className={`${BTN_SECONDARY} mt-3`}
                    onClick={() => {
                      retryCount.current += 1;
                      void start(failed, outcomes, retryCount.current);
                    }}
                  >
                    Retry failed ({failed.length})
                  </button>
                </div>
              )}
              <p className="mt-3 text-sm text-gray-600">The zips hold only pictures, so they are safe to upload to the photo counter. The index below lists every stuffy with the parent&rsquo;s name, drop-off window and photo consent, including the ones left out and why. It is for the club only: keep it off the photo counter.</p>
              {csvUrl && (
                <a href={csvUrl} download={`${manifest.filePrefix}-frames-index.csv`} className={`${BTN_SECONDARY} mt-3`}>
                  Download index (admin only)
                </a>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
