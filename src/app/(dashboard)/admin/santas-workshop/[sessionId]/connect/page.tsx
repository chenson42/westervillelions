import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { getSessionOverview, listSeenQuestions } from "@/lib/santas-workshop/session-queries";
import { recentEvents } from "@/lib/zeffy/events-queries";
import type { ZeffyEventDto } from "@/lib/santas-workshop/admin-contract";
import { SessionNav } from "@/components/admin/santas-workshop/session-nav";
import { ConnectPanel } from "@/components/admin/santas-workshop/connect-panel";
import { QuestionMapEditor } from "@/components/admin/santas-workshop/question-map-editor";
import { SyncPanel } from "@/components/admin/santas-workshop/sync-panel";
import { EventsList } from "@/components/admin/santas-workshop/events-list";

export const dynamic = "force-dynamic";

export default async function SantasWorkshopConnectPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) redirect("/access-pending");

  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();
  const [s, questions] = await Promise.all([getSessionOverview(sessionId), listSeenQuestions(sessionId)]);
  if (!s || !questions) notFound();

  const campaignId = s.zeffy.campaignId;
  const events: ZeffyEventDto[] = campaignId
    ? (await recentEvents(campaignId, 25)).map((e) => ({
        id: e.id,
        type: e.type,
        paymentId: e.paymentId,
        outcome: e.outcome,
        errorCode: e.errorCode,
        attempts: e.attempts,
        receivedAt: e.receivedAt.toISOString(),
        processedAt: e.processedAt ? e.processedAt.toISOString() : null,
        hasPayload: e.hasPayload,
      }))
    : [];

  return (
    <div className="space-y-6">
      <SessionNav session={s} active="connect" />
      <ConnectPanel
        sessionId={s.id}
        connected={{ campaignId, campaignTitle: s.zeffy.campaignTitle, ticketRateIds: s.zeffy.ticketRateIds }}
        apiKeySet={s.zeffyConfig.apiKeySet}
        hasRegistrants={s.counts.stuffies > 0}
      />
      <QuestionMapEditor sessionId={s.id} initial={questions} campaignConnected={Boolean(campaignId)} />
      <SyncPanel sessionId={s.id} campaignConnected={Boolean(campaignId)} apiKeySet={s.zeffyConfig.apiKeySet} lastSyncAt={s.lastSyncAt} />
      <EventsList events={events} lastValidEventAt={s.lastZeffyEventAt} />
    </div>
  );
}
