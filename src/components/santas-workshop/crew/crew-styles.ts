/** Class strings for the crew app: big thumb targets (56 px), 16 px inputs, brand colors (CLAUDE.md UX Guidelines). */
const FOCUS = "focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2";

export const CREW_BTN = `inline-flex w-full items-center justify-center min-h-[56px] rounded-lg bg-lions-blue px-6 py-3 text-lg font-semibold text-white transition hover:bg-lions-blue-dark disabled:opacity-60 disabled:cursor-not-allowed ${FOCUS}`;
export const CREW_BTN_GOLD = `inline-flex w-full items-center justify-center min-h-[56px] rounded-lg bg-lions-gold px-6 py-3 text-lg font-semibold text-gray-900 transition hover:bg-lions-gold-dark disabled:opacity-60 disabled:cursor-not-allowed ${FOCUS}`;
export const CREW_BTN_OUTLINE = `inline-flex w-full items-center justify-center min-h-[56px] rounded-lg border-2 border-lions-blue px-6 py-3 text-lg font-semibold text-lions-blue transition hover:bg-lions-blue/5 disabled:opacity-60 disabled:cursor-not-allowed ${FOCUS}`;
export const CREW_BTN_SMALL = `inline-flex items-center justify-center min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 ${FOCUS}`;
export const CREW_INPUT = `block w-full min-h-[52px] rounded-lg border border-gray-300 px-4 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:border-lions-blue`;
export const CREW_LABEL = "block text-sm font-semibold text-gray-700 mb-1";
export const CREW_CARD = "bg-white rounded-2xl shadow-sm overflow-hidden";
export const CREW_NOTICE_AMBER = "rounded-2xl bg-amber-50 p-4 text-amber-900";
export const CREW_NOTICE_RED = "rounded-2xl bg-red-50 p-4 text-red-800";
export const CREW_NOTICE_BLUE = "rounded-2xl bg-lions-blue/10 p-4 text-lions-blue-dark";
