import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to the Westerville Lions Club member portal.",
  alternates: {
    canonical: "https://westervillelions.org/signin",
  },
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
