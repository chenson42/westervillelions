import NextAuth, { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string; // Kept for backward compatibility
      roles: string[]; // Array of role names
      features: string[]; // Array of feature names (permissions)
      memberId?: string; // Linked member ID if applicable
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    roles?: string[];
    features?: string[];
    memberId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: string;
    roles?: string[];
    features?: string[];
    memberId?: string;
  }
}
