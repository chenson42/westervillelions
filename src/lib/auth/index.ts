import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { users, accounts, sessions, verificationTokens, members, userRoles, roles, roleFeatures, features } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: {
    strategy: "jwt",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email as string),
        });

        if (!user || !user.password) {
          return null;
        }

        // Block deactivated accounts
        if (!user.isActive) {
          return null;
        }

        const isValidPassword = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isValidPassword) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    // Block OAuth sign-in for deactivated accounts
    async signIn({ user }) {
      if (!user.id) return true; // new user — allow adapter to create them
      const dbUser = await db.query.users.findFirst({
        where: eq(users.id, user.id),
        columns: { isActive: true },
      });
      // If user doesn't exist yet (OAuth first sign-in), allow
      if (!dbUser) return true;
      return dbUser.isActive;
    },

    async session({ session, token }) {
      if (token?.sub) {
        session.user.id = token.sub;
        session.user.role = token.role as string;
        session.user.roles = (token.roles as string[]) || [];
        session.user.features = (token.features as string[]) || [];
        session.user.memberId = token.memberId as string | undefined;
        session.user.isActive = token.isActive as boolean ?? true;
      }
      return session;
    },

    async jwt({ token, user, trigger }) {
      // On initial sign-in, load user data
      if (user) {
        token.sub = user.id;
        token.role = user.role;
      }

      // Load roles, features, and active status (on sign-in or when explicitly updated)
      if (token.sub && (!token.roles || trigger === "update")) {
        const userId = token.sub;

        // Check if user is still active
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { isActive: true },
        });
        token.isActive = dbUser?.isActive ?? true;

        // Get user's roles
        const userRoleRecords = await db
          .select({
            roleName: roles.name,
            sortOrder: roles.sortOrder,
          })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .where(eq(userRoles.userId, userId))
          .orderBy(roles.sortOrder);

        const roleNames = userRoleRecords.map((r) => r.roleName);
        token.roles = roleNames;

        if (roleNames.length > 0) {
          token.role = roleNames[0];
        }

        // Get all features for user's roles
        if (roleNames.includes("admin")) {
          const allFeatures = await db.select({ name: features.name }).from(features);
          token.features = allFeatures.map((f) => f.name);
        } else {
          const roleIds = await db
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.name, roleNames[0] || ""));

          if (roleIds.length > 0) {
            const featureRecords = await db
              .selectDistinct({ name: features.name })
              .from(roleFeatures)
              .innerJoin(features, eq(roleFeatures.featureId, features.id))
              .innerJoin(roles, eq(roleFeatures.roleId, roles.id))
              .innerJoin(userRoles, eq(userRoles.roleId, roles.id))
              .where(eq(userRoles.userId, userId));

            token.features = featureRecords.map((f) => f.name);
          } else {
            token.features = [];
          }
        }

        // Check if user is linked to a member record
        const member = await db.query.members.findFirst({
          where: eq(members.userId, userId),
        });

        token.memberId = member?.id;
      }

      return token;
    },
  },
});
