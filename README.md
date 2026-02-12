# Westerville Lions Club Website

A modern, mobile-friendly website and member portal for the Westerville Lions Club.

## About

The Westerville Lions Club is dedicated to creating and fostering a spirit of understanding among all people for humanitarian needs by providing voluntary services through community involvement.

**Current Website:** https://westervillelions.org/

## Technology Stack

- **Framework:** Next.js 16 with App Router
- **Language:** TypeScript
- **Database:** PostgreSQL with Drizzle ORM
- **Authentication:** NextAuth.js 5.0 (Google OAuth + Password)
- **Styling:** Tailwind CSS v4
- **UI Components:** shadcn/ui
- **Package Manager:** pnpm

## Getting Started

### Prerequisites

- Node.js 20.x or higher (see `.nvmrc`)
- pnpm (`npm install -g pnpm`)
- PostgreSQL database

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables (create `.env.local`):
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/westerville_lions
   NEXTAUTH_URL=http://localhost:3000
   NEXTAUTH_SECRET=your-secret-key
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   ```

4. Run database migrations:
   ```bash
   pnpm db:migrate-and-push
   ```

5. Start the development server:
   ```bash
   pnpm dev
   ```

6. Open [http://localhost:3000](http://localhost:3000)

## Development

```bash
pnpm dev              # Start development server
pnpm build            # Build for production
pnpm start            # Start production server
pnpm lint             # Run linter
pnpm db:push          # Push schema changes to database
```

## Project Structure

- `/src/app` - Next.js app router pages and API routes
- `/src/components` - React components
- `/src/lib` - Utility functions and shared logic
- `/drizzle` - Database migrations and schema
- `/public` - Static assets

## Features

### Public Website
- Homepage with mission and featured activities
- About page with club information
- Events calendar
- Donation page (Givebutter integration)
- Contact page

### Member Portal
- Member directory
- Event management and RSVPs
- Admin dashboard

## Contributing

For development guidance, see [CLAUDE.md](./CLAUDE.md).

## License

Private repository for Westerville Lions Club.
