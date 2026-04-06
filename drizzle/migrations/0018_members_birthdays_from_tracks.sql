-- Harvest birthdays from The Tracks newsletters (Sep 2024 – May 2025)
-- Year is unknown; stored as --MM-DD per ISO 8601 no-year convention.
-- Only sets date_of_birth when it is currently NULL to avoid overwriting manual entries.

UPDATE members SET date_of_birth = '--11-21' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'baumh@att.net');
UPDATE members SET date_of_birth = '--05-02' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'gary.bix@att.net');
UPDATE members SET date_of_birth = '--12-27' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'jdhartman8@gmail.com');
UPDATE members SET date_of_birth = '--10-11' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'bobran26@yahoo.com');
UPDATE members SET date_of_birth = '--04-19' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'jake.jurbank@nationwidechildrens.org');
UPDATE members SET date_of_birth = '--09-10' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'prayforfamily12@gmail.com');
UPDATE members SET date_of_birth = '--11-13' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'llampel@westervillelions.org');
UPDATE members SET date_of_birth = '--11-16' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'rufusb@gmail.com');
UPDATE members SET date_of_birth = '--05-14' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'knmartin91@yahoo.com');
UPDATE members SET date_of_birth = '--02-06' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'mccu40@msn.com');
UPDATE members SET date_of_birth = '--10-25' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'jmikesell51@gmail.com');
UPDATE members SET date_of_birth = '--05-28' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'piasam7@aol.com');
UPDATE members SET date_of_birth = '--01-01' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'ciiseciise5352@gmail.com');
UPDATE members SET date_of_birth = '--09-25' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'donniebling59@gmail.com');
UPDATE members SET date_of_birth = '--12-19' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'johnparrishod@gmail.com');
UPDATE members SET date_of_birth = '--12-13' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'btireman@gmail.com');
UPDATE members SET date_of_birth = '--11-19' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'fabulousmgr@breezeline.net');
UPDATE members SET date_of_birth = '--10-14' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'jreschke14@gmail.com');
UPDATE members SET date_of_birth = '--11-09' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'artbethrobertson@gmail.com');
UPDATE members SET date_of_birth = '--12-23' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'artbethrobertson+beth@gmail.com');
UPDATE members SET date_of_birth = '--11-09' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'toddsommerfeld3@gmail.com');
UPDATE members SET date_of_birth = '--12-07' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'jstrapp37@gmail.com');
UPDATE members SET date_of_birth = '--11-20' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'krissthm@msn.com');
UPDATE members SET date_of_birth = '--02-07' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'janemenneking@gmail.com');
UPDATE members SET date_of_birth = '--04-24' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'jennifer.henson@gmail.com');
UPDATE members SET date_of_birth = '--02-27' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'khadija022awad@gmail.com');
UPDATE members SET date_of_birth = '--02-26' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'hankstonerook@gmail.com');
UPDATE members SET date_of_birth = '--01-12' WHERE date_of_birth IS NULL AND user_id = (SELECT id FROM users WHERE email = 'carl.gass@yahoo.com');
