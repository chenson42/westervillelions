import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { users, members, userRoles, roles, roleFeatures, features } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: {
    strategy: "jwt", // Use JWT strategy for credentials provider
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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

        // Find user by email
        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email as string),
        });

        if (!user || !user.password) {
          return null;
        }

        // Verify password with bcrypt
        const isValidPassword = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isValidPassword) {
          return null;
        }

        // Return user object with id as string
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
    async session({ session, token }) {
      if (token?.sub) {
        session.user.id = token.sub;
        session.user.role = token.role as string;
        session.user.roles = (token.roles as string[]) || [];
        session.user.features = (token.features as string[]) || [];
        session.user.memberId = token.memberId as string | undefined;
      }
      return session;
    },
    async jwt({ token, user, trigger }) {
      // On initial sign-in, load user data
      if (user) {
        token.sub = user.id;
        token.role = user.role;
      }

      // Load roles and features (on sign-in or when explicitly updated)
      if (token.sub && (!token.roles || trigger === "update")) {
        const userId = token.sub;

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

        // Set primary role (lowest sort_order) for backward compatibility
        if (roleNames.length > 0) {
          token.role = roleNames[0];
        }

        // Get all features for user's roles
        // Admin role gets ALL features (safeguard against lockout)
        if (roleNames.includes("admin")) {
          const allFeatures = await db.select({ name: features.name }).from(features);
          token.features = allFeatures.map((f) => f.name);
        } else {
          // Get features based on role assignments
          const roleIds = await db
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.name, roleNames[0] || "")); // Using IN would be better but this works

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
