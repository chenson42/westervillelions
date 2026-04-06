UPDATE members SET date_of_birth = '--04-16'
WHERE user_id = (SELECT id FROM users WHERE email = 'court.morgan0219@gmail.com');
