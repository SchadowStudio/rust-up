// Read-only per-project incident feed. A previously delivered callback can
// become disputed after a chain reorganization; the merchant MUST be able to
// detect this and decide on a manual hold. Never auto-debit customer credit.
export async function projectPaymentIncidents(db,projectId){
 const [audits,reviews]=await Promise.all([
  db.prepare(`SELECT i.id AS invoice_id,i.project_order_ref,
    a.state,a.failed_checks,a.last_checked_ms,a.last_error
   FROM v2_chain_audit_state a
   JOIN v2_invoices i ON i.id=a.invoice_id
   WHERE i.project_id=? AND i.status='verified'
    AND a.state IN ('uncertain','manual_review')
   ORDER BY a.last_checked_ms DESC LIMIT 100`).bind(projectId).all(),
  db.prepare(`SELECT r.id AS review_id,r.invoice_id,i.project_order_ref,
    r.reason,r.created_at_ms
   FROM v2_payment_reviews r
   JOIN v2_invoices i ON i.id=r.invoice_id
   WHERE i.project_id=? AND i.status='verified'
    AND r.resolved_at_ms IS NULL
   ORDER BY r.created_at_ms DESC LIMIT 100`).bind(projectId).all()
 ]);
 return {
  ok:true,
  auditDisputes:audits.results||[],
  openPaymentReviews:reviews.results||[],
  limitedTo:100,
  action:'Do not automatically reverse balances. Investigate and hold affected fulfillment using your own project incident policy.',
  possibleEarlierIncidents:true
 };
}
