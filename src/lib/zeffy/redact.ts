/**
 * Redaction of a REAL Zeffy payment into a committable test fixture (used by
 * scripts/spike-zeffy.ts). Pure and deterministic. The repo is public
 * (CLAUDE.md, "No Personal Data in the Repository"), so this keeps only what
 * the tests need and replaces everything that could identify a person:
 *
 *   - ids (payment, item, refund, contact) -> stable placeholders
 *   - buyer: names -> "Buyer"/"ExampleN", email -> buyerN@example.invalid, address dropped
 *   - answers: free-text kinds (text, email, phone, name, date) -> a placeholder;
 *     checkbox booleans and select CHOICES are kept, because the exact strings
 *     and shapes are the point of the spike (consent wording, `false` vs absent)
 *   - receipt URL, payment method, dispute, discount, tribute, recurring, fund,
 *     metadata dropped; amounts, statuses, refunds (amounts only) kept
 *
 * Question TEXT is kept: it is the public form's wording, and the mapper keys on it.
 */

import { isRecord } from "./types";

const FREE_TEXT_TYPES = new Set(["text", "email", "phone", "name", "date"]);

function redactAnswer(question: Record<string, unknown>, n: number): unknown {
  const answer = question.answer;
  if (typeof answer === "boolean") return answer;
  if (FREE_TEXT_TYPES.has(String(question.type))) return `[redacted ${String(question.type)} ${n}]`;
  // single_select / multi_select: the chosen option text (kept).
  return answer;
}

function redactQuestions(list: unknown, counter: { n: number }): unknown[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isRecord).map((q) => {
    counter.n += 1;
    return { question: q.question, type: q.type, answer: redactAnswer(q, counter.n) };
  });
}

export function redactPaymentForFixture(payment: unknown, index = 1): Record<string, unknown> {
  if (!isRecord(payment)) throw new Error("redactPaymentForFixture: not an object");
  const counter = { n: 0 };
  const buyer = isRecord(payment.buyer) ? payment.buyer : {};
  const items = Array.isArray(payment.items) ? payment.items.filter(isRecord) : [];
  const refunds = Array.isArray(payment.refunds) ? payment.refunds.filter(isRecord) : [];
  const pad = String(index).padStart(2, "0");

  return {
    id: `fixture-payment-${pad}`,
    object: "payment",
    created: typeof payment.created === "number" ? payment.created : 0,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    type: payment.type,
    refund_status: payment.refund_status,
    refunds: refunds.map((r, i) => ({
      id: `fixture-refund-${pad}-${i + 1}`,
      object: "refund",
      amount: r.amount,
      currency: r.currency,
      status: r.status,
      created: typeof r.created === "number" ? r.created : 0,
    })),
    buyer: {
      email: buyer.email ? `buyer${pad}@example.invalid` : null,
      first_name: buyer.first_name ? "Buyer" : null,
      last_name: buyer.last_name ? `Example${pad}` : null,
    },
    campaign_id: payment.campaign_id,
    campaign_category: payment.campaign_category,
    buyer_questions: redactQuestions(payment.buyer_questions, counter),
    items: items.map((item, i) => ({
      id: `fixture-item-${pad}-${i + 1}`,
      object: "item",
      type: item.type,
      amount: item.amount,
      currency: item.currency,
      rate_id: item.rate_id,
      rate_title: item.rate_title,
      questions: redactQuestions(item.questions, counter),
    })),
    occurrence_id: null,
    receipt_url: null,
    metadata: {},
  };
}
