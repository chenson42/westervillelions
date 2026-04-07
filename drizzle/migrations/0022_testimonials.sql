-- Create testimonials table
CREATE TABLE IF NOT EXISTS testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote text NOT NULL,
  author_name text NOT NULL,
  author_title text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Seed: Lori Lampel testimonial
INSERT INTO testimonials (quote, author_name, author_title, is_active, sort_order)
SELECT
  'A friend invited me to a Westerville Lions meeting, and I''m so glad I said yes. I found not just a way to give back, but a whole new circle of friends who share that same commitment. We serve our community, support each other, and have fun along the way. I''d encourage anyone to come see what we''re about.',
  'Lori Lampel',
  'Lion & Secretary, member since 2022',
  true,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM testimonials WHERE author_name = 'Lori Lampel'
);
