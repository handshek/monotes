"use client";

/*
 * TEST-ONLY overlay for the isolated local backends started by
 * scripts/collab-e2e.sh and scripts/dev-signed-in.sh; see
 * tests/collab-e2e/overlay/convex/auth.ts. Never part of the application.
 *
 * Every account uses the same password and is created on first sign-in.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/sodium/ui/button";
import { Field, FieldLabel } from "@/components/sodium/ui/field";
import { Input } from "@/components/sodium/ui/input";

const PASSWORD = "test-password-1234";
const TEST_ACCOUNTS = ["alice@test.local", "bob@test.local"];

export function SigninForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const signInAs = async (account: string) => {
    setError("");
    setPending(account);
    try {
      try {
        await signIn("password", { email: account, password: PASSWORD, flow: "signUp" });
      } catch {
        await signIn("password", { email: account, password: PASSWORD, flow: "signIn" });
      }
    } catch (failure) {
      setError(String(failure));
      setPending(null);
      return;
    }
    router.push("/");
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="type-title text-text-1">Test sign in</h1>
      <div className="flex flex-col gap-2">
        {TEST_ACCOUNTS.map((account) => (
          <Button
            key={account}
            variant="secondary"
            pending={pending === account}
            onClick={() => signInAs(account)}
          >
            Sign in as {account}
          </Button>
        ))}
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void signInAs(email);
        }}
      >
        <Field>
          <FieldLabel>Test email</FieldLabel>
          <Input id="test-email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Button type="submit" pending={pending === email && email !== ""}>
          Test sign in
        </Button>
      </form>
      {error && <p role="alert" className="type-caption text-fail-text">{error}</p>}
    </div>
  );
}
