-- Strip honorific prefixes (Mr., Mrs., Ms., Ms, Dr., Miss) from users.name
UPDATE users
SET name = regexp_replace(name, '^(Mr\.|Mrs\.|Ms\.?|Dr\.|Miss)\s+', '', 'i')
WHERE name ~ '^(Mr\.|Mrs\.|Ms\.?|Dr\.|Miss)\s+';
