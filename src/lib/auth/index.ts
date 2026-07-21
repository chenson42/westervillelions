import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { users, accounts, members, userRoles, roles, roleFeatures, features } from "@/lib/db/schema";
import { and, eq, ilike } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sendEmail } from "@/lib/email";
import { recordFailedLogin } from "@/lib/auth/failed-login";

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
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
          recordFailedLogin({
            attemptedEmail: credentials?.email as string | undefined,
            provider: "credentials",
            reason: "missing_credentials",
          });
          return null;
        }

        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email as string),
        });

        if (!user) {
          recordFailedLogin({
            attemptedEmail: credentials.email as string,
            provider: "credentials",
            reason: "unknown_email",
          });
          return null;
        }

        if (!user.password) {
          recordFailedLogin({
            attemptedEmail: credentials.email as string,
            provider: "credentials",
            reason: "no_password_set",
            userId: user.id,
          });
          return null;
        }

        // Block deactivated accounts
        if (!user.isActive) {
          recordFailedLogin({
            attemptedEmail: credentials.email as string,
            provider: "credentials",
            reason: "deactivated",
            userId: user.id,
          });
          return null;
        }

        const isValidPassword = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isValidPassword) {
          recordFailedLogin({
            attemptedEmail: credentials.email as string,
            provider: "credentials",
            reason: "bad_password",
            userId: user.id,
          });
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
      if (!dbUser.isActive) {
        recordFailedLogin({
          attemptedEmail: user.email,
          provider: "google",
          reason: "oauth_deactivated",
          userId: user.id,
        });
        return false;
      }
      return true;
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
        // Fire-and-forget so we don't block the JWT response, but serialize the
        // three DB operations (lastLoginAt update, auto-link, admin notify) so
        // they don't race each other.
        if (user.id) {
          const userId = user.id;
          const userEmail = user.email ?? "";
          const userName = user.name ?? "";
          (async () => {
            try {
              const pre = await db.query.users.findFirst({
                where: eq(users.id, userId),
                columns: { memberId: true, lastLoginAt: true },
              });
              const isFirstLogin = pre?.lastLoginAt == null;

              await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));

              // Auto-match @westervillelions.org Google sign-ins to member records by name
              let linkedMemberId: string | null = pre?.memberId ?? null;
              if (!linkedMemberId && userEmail.endsWith("@westervillelions.org")) {
                const nameParts = userName.trim().split(/\s+/);
                if (nameParts.length >= 2) {
                  const first = nameParts[0];
                  const last = nameParts[nameParts.length - 1];
                  const matchedMember = await db.query.members.findFirst({
                    where: and(
                      ilike(members.firstName, first),
                      ilike(members.lastName, last),
                      eq(members.isActive, true)
                    ),
                  });
                  if (matchedMember) {
                    const conflict = await db
                      .select({ id: users.id })
                      .from(users)
                      .where(eq(users.memberId, matchedMember.id))
                      .limit(1);
                    if (conflict.length === 0) {
                      await db.update(users).set({ memberId: matchedMember.id }).where(eq(users.id, userId));
                      token.memberId = matchedMember.id;
                      linkedMemberId = matchedMember.id;
                    }
                  }
                }
              }

              // Notify admins on the user's first-ever sign-in if they remain unlinked.
              // Gating on isFirstLogin prevents an unlinked user from flooding the
              // admin inbox by repeatedly signing in.
              if (isFirstLogin && !linkedMemberId) {
                const esc = (s: string) =>
                  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
                const fromEmail = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
                await sendEmail({
                  from: `Westerville Lions Portal <${fromEmail}>`,
                  to: "info@westervillelions.org",
                  subject: "New portal user needs member record review",
                  html: `
                    <h2>Unlinked User Alert</h2>
                    <p>A user signed in to the member portal but is not linked to any member record.</p>
                    <p><strong>Name:</strong> ${esc(userName || "(unknown)")}</p>
                    <p><strong>Email:</strong> ${esc(userEmail)}</p>
                    <p>Please review this account in the <a href="https://westervillelions.org/admin/users">Admin → Users</a> page and link them to a member record if appropriate.</p>
                  `,
                });
              }
            } catch {
              // Swallow — JWT callback must not throw.
            }
          })();
        }
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
        const dbUserForMember = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { memberId: true },
        });
        token.memberId = dbUserForMember?.memberId ?? undefined;
      }

      return token;
    },
  },
  events: {
    // The DrizzleAdapter creates the users row on first OAuth sign-in but
    // doesn't touch user_roles. Assign the default "member" role here so
    // every new user lands with at least one role.
    async createUser({ user }) {
      if (!user.id) return;
      const memberRole = await db.query.roles.findFirst({
        where: eq(roles.name, "member"),
      });
      if (!memberRole) return;
      const existing = await db.query.userRoles.findFirst({
        where: and(eq(userRoles.userId, user.id), eq(userRoles.roleId, memberRole.id)),
      });
      if (existing) return;
      await db.insert(userRoles).values({ userId: user.id, roleId: memberRole.id });
    },
  },
});
