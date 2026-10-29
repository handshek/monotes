"use client";

/*
 * TEST-ONLY overlay for the isolated collaboration browser tests; see
 * tests/collab-e2e/overlay/convex/auth.ts. Never part of the application.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/sodium/ui/button";
import { Field, FieldLabel } from "@/components/sodium/ui/field";
import { Input } from "@/components/sodium/ui/input";

export function SigninForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const password = "test-password-1234";
  return (
    <form
      className="flex flex-col gap-3"
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
      <Field>
        <FieldLabel>Test email</FieldLabel>
        <Input id="test-email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      <Button type="submit">Test sign in</Button>
      {error && <p role="alert" className="type-caption text-fail-text">{error}</p>}
    </form>
  );
}
