/**
 * ADR-001 money formatting, shared by every buyer surface.
 *
 * `price_amount` arrives from the read model as a decimal string (the
 * ::text cast), and currency is explicit on the revision. The en-KE
 * locale renders KES as "KSh 1,234,567" — no manual prefix needed.
 * Recurring periods get a display suffix; one-off sales get none.
 */

export function formatListingPrice(
  amount: string,
  currency: string,
  period: string,
): string {
  const value = new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));
  const suffix =
    period === 'per_month' ? ' /mo' : period === 'per_night' ? ' /night' : '';
  return `${value}${suffix}`;
}
