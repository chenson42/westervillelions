-- Mark known family-rate members as 'family' so they are billed the discounted
-- family dues amount (FY2026: $96 vs. $120 individual). Their primary-member
-- spouses remain 'individual'.
--
-- Matched by email (members.email is NOT NULL + case-insensitively unique per
-- migration 0035). Idempotent: the `dues_category <> 'family'` guard makes a
-- re-run a no-op (and only touches updated_at when a row actually changes).
-- Like the treasurer bindings in 0040, this re-asserts the value on every
-- deploy; if any of these members ever stops being a family-rate member, remove
-- their line here as well as changing it in the UI.
UPDATE members
SET dues_category = 'family', updated_at = now()
WHERE LOWER(email) IN (
  'lionaimee@outlook.com',      -- Aimee Westlund
  'bethrobertson029@gmail.com', -- Beth Robertson
  'jennifer.henson@gmail.com'   -- Jennifer Henson
)
AND dues_category <> 'family';
