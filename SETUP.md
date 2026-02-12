# Westerville Lions Club - Setup Instructions

This guide will help you set up and run the prototype locally.

## Prerequisites

- Node.js 20.x or higher (check with `node --version`)
- PostgreSQL database
- pnpm package manager (`npm install -g pnpm`)

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up PostgreSQL Database

Create a new PostgreSQL database:

```bash
createdb westerville_lions
```

Or use your preferred PostgreSQL client (pgAdmin, DBeaver, etc.)

### 3. Configure Environment Variables

The `.env.local` file has been created with default values. Update it with your actual credentials:

```env
# Update with your PostgreSQL connection string
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/westerville_lions

# Generate a secure secret for production
NEXTAUTH_SECRET=your-super-secret-key-change-this-in-production

# Add your Google OAuth credentials (optional for prototype)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

**To generate a secure `NEXTAUTH_SECRET`:**
```bash
openssl rand -base64 32
```

### 4. Initialize Database

Run migrations to create tables:

```bash
pnpm db:migrate-and-push
```

### 5. Import Member Roster

Import the member roster from the Excel file:

```bash
pnpm db:import-roster
```

This will import all 47 members from the roster file. The script handles:
- Name parsing (removes titles, splits first/last names)
- Date conversion
- The duplicate email for the Robertsons (creates variant email)
- Member numbers and branch information

### 6. Start Development Server

```bash
pnpm dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## Testing the Prototype

### Public Pages
- Homepage: http://localhost:3000
- About: http://localhost:3000/about
- Mission: http://localhost:3000/mission
- Events: http://localhost:3000/events
- Donate: http://localhost:3000/donate
- Contact: http://localhost:3000/contact

### Member Login
- Login page: http://localhost:3000/signin

**To log in (Prototype Mode):**
- Use any email from the imported roster
- No password required (this is a prototype feature)
- Example: `baumh@att.net`

**Or use Google OAuth** (if configured)

### Member Portal
After logging in, you'll have access to:
- Member Directory: View all club members
- Events: View club events
- Profile: View your profile information

## Database Management

### View Database Schema
```bash
pnpm db:push
```

### Re-import Roster (if needed)
```bash
# This will skip existing users
pnpm db:import-roster
```

## Troubleshooting

### "Database does not exist"
Make sure you created the PostgreSQL database:
```bash
createdb westerville_lions
```

### "Connection refused"
Check that PostgreSQL is running:
```bash
# macOS
brew services list

# Linux
sudo systemctl status postgresql
```

### "Module not found" errors
Re-install dependencies:
```bash
rm -rf node_modules
pnpm install
```

### Port 3000 already in use
Either stop the other process or run on a different port:
```bash
pnpm dev -- -p 3001
```

## Project Structure

```
westervillelions/
├── src/
│   ├── app/                    # Next.js pages
│   │   ├── (public pages)      # Homepage, about, mission, etc.
│   │   ├── members/            # Member portal (protected)
│   │   └── signin/             # Login page
│   ├── components/             # React components
│   │   ├── layout/             # Header, Footer
│   │   └── ui/                 # UI components
│   └── lib/
│       ├── auth/               # Authentication
│       └── db/                 # Database connection & schema
├── scripts/
│   └── import-roster.ts        # Roster import script
└── drizzle/
    └── migrations/             # Database migrations
```

## Next Steps for Development

1. **Set up Google OAuth** - Add your Google for Nonprofits credentials
2. **Configure Givebutter** - Update the donate page with your campaign URL
3. **Add real events** - Create some sample events in the database
4. **Customize content** - Update pages with actual club information
5. **Add photos** - Add images to make the site more visually appealing

## Production Deployment

For production deployment:
1. Use a secure `NEXTAUTH_SECRET`
2. Set up proper Google OAuth credentials
3. Use a production PostgreSQL database
4. Enable HTTPS
5. Configure proper authentication (remove prototype email-only login)

## Support

For questions or issues, refer to:
- `CLAUDE.md` - Development guidance
- `README.md` - Project overview
