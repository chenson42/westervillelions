# Campaign cards: no fallback picture, equal heights, visible title — Work Log

> **Slug:** `2026-10-12-campaign-cards-no-fallback-image`
> **Surface:** public (`/donate`, and the member-only campaign grid on the same page)
> **Permission(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant, accelerated; ships with v1.92.0

## Origin

The user, 2026-10-12, while preparing the White Cane 2026 campaign: "lets also make sure all the cards are the same size and if no picture is set we just don't use a picture". No production campaign has a stored image, so every card on `/donate` was showing the same generic brand photo (`/images/service-community.jpg`), which the June 2026 fix introduced to avoid a broken image when Zeffy's og:image scrape started 403ing.

## Phases

- **1 (analyst):** skipped; the user's instruction is the specification and reverses the June 2026 "every card shows an image" rule on purpose. Preserved intent: a card is never blank and never shows a broken image. Because the title only ever appeared as the button label, a card with no picture and no description would have been a lone button, so the card now carries its title as an `h3`.
- **2 (architect):** skipped; no structure, dependency or invariant.
- **3 (tech-lead):** skipped; root cause is the fallback constant in `campaign-card.tsx`, and `items-start` on both grids, which let cards take their own height.
- **4 (orchestrator, absorbed):** `CampaignCard` renders `<img>` only when `campaign.image` is set (`aspect-[16/9] object-cover`, decorative `alt=""` because the title is now text), adds the title heading, stretches `h-full flex flex-col` with the Zeffy button in an `mt-auto` block, and keeps the Members Only badge in the image corner when there is an image or beside the title when there is not. Both grids drop `items-start`. `CAMPAIGN_CARD_FALLBACK_IMAGE` removed (no other importer). CLAUDE.md Zeffy bullet updated.
- **5 (qa, orchestrator-run):** `e2e/donate.spec.ts` regression #1 rewritten: every card has a visible non-empty title; an image element exists at most once and only with a non-empty src that is not the old fallback; cards sharing a row share a height. Results recorded below.
- **6:** the user confirms on the live page after the push.

## Production data write (orchestrator, 2026-10-12)

The user's words: "can you add descriptions for donate to lions club and membership dues in the production campaign table?" Two `UPDATE campaigns SET description = …, updated_at = now() WHERE title = '<title>' AND description IS NULL RETURNING title` statements, one per row. Counts: `description IS NULL` 2 of 4 before, 0 of 4 after; each UPDATE returned 1. Text set: Donate to Lions Club: "A gift to the general fund goes where it is needed most: youth scholarships, hunger relief, vision care, and local humanitarian projects in Westerville. Every dollar stays in our community's programs." Membership Dues: "Pay your annual Westerville Lions Club membership dues online. Questions about your dues or your record? Contact the treasurer." Both are editable at `/admin/campaigns`. Noted while reading: the Raffle Tickets description ends in an ellipsis in the stored text; the user may want to finish that sentence in the admin.
