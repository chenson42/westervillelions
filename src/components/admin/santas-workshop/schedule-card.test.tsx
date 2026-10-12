import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScheduleCard } from "./schedule-card";

describe("ScheduleCard", () => {
  const html = renderToStaticMarkup(
    <ScheduleCard
      dropoffDate="2026-12-18"
      photoDate="2026-12-19"
      pickupDate="2026-12-20"
      windows={[{ id: "w1", label: "4:00 to 5:00 PM", start: "16:00", end: "17:00" }]}
    />,
  );

  it("prints each weekday exactly once", () => {
    expect(html).toContain("Friday, Dec 18");
    expect(html).toContain("Saturday, Dec 19");
    expect(html).toContain("Sunday, Dec 20");
    for (const day of ["Friday", "Saturday", "Sunday"]) expect(html.split(day).length - 1, day).toBe(1);
    expect(html).not.toMatch(/(Friday|Saturday|Sunday), (Friday|Saturday|Sunday)/);
  });

  it("lists the window labels", () => {
    expect(html).toContain("4:00 to 5:00 PM");
  });
});
