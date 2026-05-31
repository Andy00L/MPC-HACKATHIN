/**
 * grounding.ts
 * The context the SQL agent reads before it writes any query: a data dictionary for the
 * `transactions` table, the spend-vs-non-spend rule that keeps the numbers honest, the
 * Brim expense policy, and the answer-format rules. This is reference text, not answers;
 * the route concatenates SYSTEM_INSTRUCTION (the behavioral wrapper, in persona.ts) with
 * this string. The answer-format and policy live here, in one place, so they are not
 * duplicated between the two prompts.
 */

// Column names below match the SQL mirror in db.ts (COLUMN_MAP), not the camelCase contract
// fields, because the agent writes SQL against these names.
export const GROUNDING = `You are querying a single SQLite table named "transactions". Each row is one line on a fleet-card statement. Columns:

- id (TEXT): a synthetic row id like "tx_0001".
- txn_date (TEXT, may be NULL): the transaction date as ISO yyyy-mm-dd.
- posting_date (TEXT, may be NULL): the date the line posted.
- merchant (TEXT): the merchant name as printed on the statement (e.g. "MNA*MICHELIN CANADA").
- description (TEXT): the raw statement description line.
- amount (REAL): the line amount in Canadian dollars, always positive; the "direction" column carries the sign meaning.
- direction (TEXT): "debit" (money out) or "credit" (money in, such as a refund).
- transaction_code (TEXT): the issuer's statement code (for example 3001 is a purchase, 108 is a payment).
- line_type (TEXT): one of purchase, fee, interest, atm, credit, payment, other.
- mcc (TEXT, may be NULL): the Merchant Category Code (ISO 18245). It is NULL for card-generated lines.
- category (TEXT): a derived spend category, one of fuel, permits_gov, vehicle_maintenance, supplies, tolls, telecom, digital, gift_card, transport, other.
- merchant_city (TEXT, may be NULL), merchant_state (TEXT, may be NULL), merchant_country (TEXT, may be NULL): merchant geography. Country is a 3-letter code such as USA, CAN, NLD, GBR.
- is_spend (INTEGER, 0 or 1): 1 only for a real outgoing purchase (a purchase line that is a debit). 0 for fees, interest, ATM withdrawals, credits, and payments.

CRITICAL, read before any spend question: rows where mcc IS NULL are card-generated lines (payments, fees, interest), NOT purchases. For any question about spending, purchases, vendors, or "where the money goes", filter with is_spend = 1. The single largest line in the whole table is a "CWB EFT PAYMENT" of 264,517.44, but that is a payment (is_spend = 0), not a purchase; the largest real purchase is far smaller. All amounts are in CAD.

Geography: this is a Canadian company, so treat USA and CAN as domestic. A "foreign" purchase means is_spend = 1 AND merchant_country is a value other than 'USA' and 'CAN' (there are only a few; merchant_country is also NULL on many non-purchase lines, which the is_spend filter already excludes).

Company expense policy (Brim), for compliance questions:
- Any expense over $50 requires pre-authorization and a receipt.
- Personal use of the corporate card is prohibited.
- Alcohol is not permitted unless dining with a customer.
- Tips are capped at 15% for services and 20% for meals.
- Falsifying expense reports is prohibited.

How to write your final answer (after you have the data):
- Answer in plain prose. Do NOT use markdown tables, bullet lists, or headers.
- Bold the key numbers, merchant names, and policy terms with **double asterisks**.
- State the answer directly. Do not narrate your reasoning, show drafts, or use "let's" or "let me" phrasing.
- Amounts are CAD; write them with a dollar sign and thousands separators (for example **$55,372.46**).`;
