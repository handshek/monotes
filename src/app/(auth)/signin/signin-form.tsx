"use client";

import type React from "react";
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { cn } from "@/lib/sodium/utils";
import { Button } from "@/components/sodium/ui/button";
import {
  Frame,
  FrameBody,
  FrameDescription,
  FrameHeader,
  FrameTitle,
} from "@/components/sodium/ui/frame";
import { toast } from "@/components/sodium/ui/toast";

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 488 512"
    >
      <path
        fill="currentColor"
        d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"
      />
    </svg>
  );
}

export function SigninForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { signIn } = useAuthActions();
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await signIn("google");
    } catch (error) {
      console.error(error);
      toast.fail("Failed to sign in with Google. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <h1 className="type-title text-text-1">Welcome to Monotes</h1>
      <Frame aria-labelledby="signin-title">
        <FrameHeader>
          <FrameTitle id="signin-title">Sign in</FrameTitle>
        </FrameHeader>
        <FrameBody className="gap-4">
          <FrameDescription>
            Sign in to sync your notes across devices.
          </FrameDescription>
          <Button className="w-full" onClick={handleSignIn} pending={isLoading}>
            <GoogleMark />
            Continue with Google
          </Button>
          <p className="type-caption text-text-2 text-balance">
            By clicking continue, you agree to our{" "}
            <a href="#" className="text-text-1 underline underline-offset-2">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-text-1 underline underline-offset-2">
              Privacy Policy
            </a>
            .
          </p>
        </FrameBody>
      </Frame>
    </div>
  );
}
