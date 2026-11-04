# Volunteer app: choose a saved photo as well as take one

**Started:** 2026-11-04 · **Type:** small change (bug-fix variant) · **Status:** Phase 4 complete; Phase 5 reduced (practice-test feedback, user wants it quickly)

## Request
From the user's practice test with a volunteer: "anywhere you can take a picture can we also make it so you can upload a photo?"

## Change
`src/components/santas-workshop/crew/photo-capture.tsx` is the one photo component behind check-in, portrait and group photos. It now has a second file input without `capture` and a "Choose a saved photo" button (outlined, under "Take photo"). Both inputs feed the same preview, "Use photo" and upload path (downscale, outbox, same server checks), and Retake clears both. The e2e crew-flow spec now targets the camera input (`input[type="file"][capture]`) because the page has two file inputs.

## Phases
- 1–3 skipped by the orchestrator: client-only, no API, schema or permission change; uploads use the existing route and limits.
- 4 inline by the orchestrator.
- 5 reduced: `tsc` clean, eslint clean on the component, full `pnpm test` 5776/5776. Not run: build, e2e, a real phone.

## Note
A saved photo may be any photo on the volunteer's phone, so the "Stuffies only, never the children" reminder above the buttons matters more; it stays.
