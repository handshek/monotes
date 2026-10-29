import { SigninForm } from "./signin-form";

export default function Page() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-page p-4 text-text-1 md:p-10">
      <div className="w-full max-w-sm">
        <SigninForm />
      </div>
    </main>
  );
}
