"use client";

/*
 * TEST-ONLY overlay for the isolated collaboration browser tests; see
 * tests/collab-e2e/overlay/convex/auth.ts. Never part of the application.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";

export function SigninForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const password = "test-password-1234";
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await signIn("password", { email, password, flow: "signUp" });
        } catch {
          try {
            await signIn("password", { email, password, flow: "signIn" });
          } catch (failure) {
            setError(String(failure));
            return;
          }
        }
        router.push("/");
      }}
    >
      <label htmlFor="test-email">Test email</label>
      <input id="test-email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <button type="submit">Test sign in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
