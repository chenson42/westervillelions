import { headers } from "next/headers";
import { CodeEntry } from "@/components/santas-workshop/crew/code-entry";
import { CrewApp } from "@/components/santas-workshop/crew/crew-app";
import { AUTH_REASON_MESSAGES } from "@/components/santas-workshop/crew/crew-messages";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import type { CrewAuthReason } from "@/lib/santas-workshop/crew-contract";

export const dynamic = "force-dynamic";

/**
 * The worker app's front door. The gate is `requireCrew` (the same one every crew API
 * route uses), so the page and the API can never disagree: a valid worker cookie, or a
 * signed-in club admin, gets the app; everyone else gets ONLY the code screen, which
 * says nothing about the session (its name, whether it exists, why the code failed).
 * The reason (paused, closed, signed out) is revealed only when the cookie's signature
 * was valid, exactly as the API does.
 */
export default async function CrewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const h = await headers();
  const request = new Request("http://crew.invalid/", { headers: { cookie: h.get("cookie") ?? "" } });
  const gate = await requireCrew(request, { slug });

  if (!gate.ok) {
    let notice: string | null = null;
    try {
      const body = (await gate.response.json()) as { reason?: CrewAuthReason };
      if (body.reason && body.reason in AUTH_REASON_MESSAGES) notice = AUTH_REASON_MESSAGES[body.reason];
    } catch {
      notice = null;
    }
    return <CodeEntry slug={slug} notice={notice} />;
  }

  return <CrewApp slug={slug} adminBypass={gate.credential.kind === "admin"} />;
}
