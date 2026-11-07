// Aggregate-only audit of RUST UP's EXISTING admin records.
// admins.who and Worker FIRST_ADMIN are labels for reporting, not privileges.
export const EXISTING_ADMIN_SQL = `
WITH first_admin(alias) AS (VALUES (?)),
classified AS (
 SELECT
  CASE WHEN EXISTS (
   SELECT 1 FROM admins ad WHERE
    TRIM(ad.who)=CAST(a.id AS TEXT)
    OR (TRIM(COALESCE(u.username,''))<>''
     AND LOWER(LTRIM(TRIM(ad.who),'@'))=
         LOWER(LTRIM(TRIM(u.username),'@')))
  ) THEN 1 ELSE 0 END AS legacy_admin,
  CASE WHEN EXISTS (
   SELECT 1 FROM first_admin fa WHERE
     TRIM(fa.alias)<>''
     AND (TRIM(fa.alias)=CAST(a.id AS TEXT)
      OR (TRIM(COALESCE(u.username,''))<>''
       AND LOWER(LTRIM(TRIM(fa.alias),'@'))=
           LOWER(LTRIM(TRIM(u.username),'@'))))
  ) THEN 1 ELSE 0 END AS first_admin,
  CASE WHEN u.id IS NULL OR u.balance IS NULL
    OR json_valid(a.state)=0
    OR (CASE WHEN json_valid(a.state)=1 THEN
      json_type(a.state,'$.balance') NOT IN ('integer','real')
      OR json_extract(a.state,'$.balance')<0
      OR json_extract(a.state,'$.balance')>=1000000
      OR ABS(json_extract(a.state,'$.balance')-u.balance)>=0.000001
      OR ABS(json_extract(a.state,'$.balance')*100-
              ROUND(json_extract(a.state,'$.balance')*100))>0.00001
     ELSE 1 END)
   THEN 1 ELSE 0 END AS needs_review
 FROM accounts a LEFT JOIN users u ON u.id=a.id
)
SELECT COUNT(*) AS account_count,
 COALESCE(SUM(CASE WHEN legacy_admin=1 OR first_admin=1 THEN 1 ELSE 0 END),0)
  AS known_admin_accounts,
 COALESCE(SUM(legacy_admin),0) AS legacy_admin_accounts,
 COALESCE(SUM(first_admin),0) AS first_admin_accounts,
 COALESCE(SUM(needs_review),0) AS review_accounts,
 COALESCE(SUM(CASE WHEN needs_review=1 AND
   (legacy_admin=1 OR first_admin=1) THEN 1 ELSE 0 END),0)
  AS admin_review_accounts,
 COALESCE(SUM(CASE WHEN needs_review=1 AND
   legacy_admin=0 AND first_admin=0 THEN 1 ELSE 0 END),0)
  AS regular_review_accounts
FROM classified`.trim();

export function evaluateExistingAdminCounts(data) {
 const fields=['account_count','known_admin_accounts','legacy_admin_accounts',
  'first_admin_accounts','review_accounts','admin_review_accounts',
  'regular_review_accounts'];
 if (!data || fields.some(key=>!Number.isSafeInteger(data[key])||
   data[key]<0 || (key!=='account_count' && data[key]>data.account_count)))
  throw Error('existing_admin_aggregate_invalid');
 if(data.admin_review_accounts+data.regular_review_accounts!==
    data.review_accounts ||
    data.admin_review_accounts>data.known_admin_accounts ||
    data.known_admin_accounts>data.legacy_admin_accounts+
     data.first_admin_accounts)
  throw Error('existing_admin_aggregate_inconsistent');
 return {
  source:'existing_admins_and_FIRST_ADMIN',
  adminAccounts:data.known_admin_accounts,
  adminAccountsWithBalanceReview:data.admin_review_accounts,
  otherAccountsWithBalanceReview:data.regular_review_accounts,
  adminClassificationOnly:true,
  identityVerifiedForPayments:false,
  paymentRulesUnchanged:true
 };
}
