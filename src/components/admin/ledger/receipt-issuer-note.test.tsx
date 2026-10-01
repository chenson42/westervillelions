/** C42: the register's receipt-issuer marker renders only when the issuer differs. */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReceiptIssuerNote from "./receipt-issuer-note";

const CLUB = "e0000000-0000-4000-8000-0000000000c1";
const FOUNDATION = "e0000000-0000-4000-8000-0000000000f1";

describe("ReceiptIssuerNote (C42)", () => {
  it("shows the issuer and the sent date when another entity issued the receipt", () => {
    const html = renderToStaticMarkup(
      <ReceiptIssuerNote
        doneeEntityId={FOUNDATION}
        rowEntityId={CLUB}
        issuerName="Foundation"
        sentAt={new Date("2026-09-20T16:00:00Z")}
      />,
    );
    expect(html).toContain("Receipt on file, issued by the Foundation");
    expect(html).toContain("sent Sep 20, 2026");
  });

  it("omits the date when the receipt was not sent", () => {
    const html = renderToStaticMarkup(
      <ReceiptIssuerNote doneeEntityId={FOUNDATION} rowEntityId={CLUB} issuerName="Foundation" sentAt={null} />,
    );
    expect(html).toContain("issued by the Foundation");
    expect(html).not.toContain("sent ");
  });

  it("renders nothing when the issuer is the register's own entity, or the stamp is null", () => {
    expect(
      renderToStaticMarkup(
        <ReceiptIssuerNote doneeEntityId={FOUNDATION} rowEntityId={FOUNDATION} issuerName="Foundation" sentAt={null} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <ReceiptIssuerNote doneeEntityId={null} rowEntityId={CLUB} issuerName="Foundation" sentAt={null} />,
      ),
    ).toBe("");
  });
});
