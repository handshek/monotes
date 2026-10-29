"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon, User } from "@/components/sodium/icon";
import { Input } from "@/components/sodium/ui/input";
import { Button } from "@/components/sodium/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/sodium/ui/field";
import { toast } from "@/components/sodium/ui/toast";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIcon,
  EmptyTitle,
} from "@/components/sodium/ui/empty-state";

function ProfileHeading() {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="type-heading-sm text-text-1">Profile</h3>
      <p className="type-body-sm text-text-2">
        Manage your account information and preferences.
      </p>
    </div>
  );
}

export default function GeneralSettings() {
  const currentUser = useQuery(api.user.currentUser);
  const updateUserName = useMutation(api.user.updateUserName);
  const router = useRouter();
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize name from user data
  useEffect(() => {
    if (currentUser?.name) {
      setName(currentUser.name);
      setHasChanges(false);
    }
  }, [currentUser?.name]);

  // Check if name has changed from original
  useEffect(() => {
    if (currentUser?.name !== undefined) {
      setHasChanges(name.trim() !== (currentUser.name || "").trim());
    }
  }, [name, currentUser?.name]);

  const handleSave = async () => {
    const trimmedName = name.trim();

    // Validation
    if (trimmedName.length === 0) {
      toast.fail("Name cannot be empty");
      return;
    }
    if (trimmedName.length > 100) {
      toast.fail("Name must be 100 characters or less");
      return;
    }

    setIsSaving(true);
    try {
      await updateUserName({ name: trimmedName });
      toast.success("Name updated successfully");
      setHasChanges(false);
    } catch (error) {
      console.error("Failed to update name:", error);
      toast.fail(
        error instanceof Error
          ? error.message
          : "Failed to update name. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Show loading state while user data is loading
  if (currentUser === undefined) {
    return (
      <div
        role="status"
        aria-label="Loading profile"
        className="flex items-center justify-center py-8 text-text-2"
      >
        <span className="pending" />
      </div>
    );
  }

  // Show message if user is not authenticated
  if (currentUser === null) {
    return (
      <div className="flex flex-col gap-4">
        <ProfileHeading />
        <Empty reason="no-access" variant="plain" size="sm">
          <EmptyIcon icon={User} />
          <EmptyHeader>
            <EmptyTitle>Sign in required</EmptyTitle>
            <EmptyDescription>
              Please sign in to manage your account settings and sync your notes
              across devices.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => router.push("/signin")}>
              Go to sign in
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const displayName =
    currentUser.name || currentUser.email?.split("@")[0] || "User";
  const email = currentUser.email || "No email";

  return (
    <div className="flex flex-col">
      <ProfileHeading />

      <FieldGroup className="mt-4 gap-0">
        {/* Profile picture */}
        <div className="rule-row flex items-center gap-3 pb-3">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden border border-line bg-well text-text-3">
            {currentUser.image ? (
              <Image
                src={currentUser.image}
                alt={displayName}
                width={48}
                height={48}
                className="size-full object-cover"
              />
            ) : (
              <Icon icon={User} size={20} />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="type-label-sm text-text-2">Profile picture</p>
            <p className="type-body-sm text-text-2">
              Profile pictures are managed by your authentication provider.
            </p>
          </div>
        </div>

        <Field className="rule-row py-3">
          <FieldLabel>Email</FieldLabel>
          <Input id="email" type="email" value={email} disabled />
          <FieldDescription>
            Email addresses cannot be changed here.
          </FieldDescription>
        </Field>

        <Field className="rule-row py-3">
          <FieldLabel>Name</FieldLabel>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            maxLength={100}
            disabled={isSaving}
          />
          <FieldDescription>
            This is how your name will appear in the application.
          </FieldDescription>
        </Field>
      </FieldGroup>

      <div className="flex justify-end pt-3">
        <Button
          onClick={handleSave}
          pending={isSaving}
          pendingLabel="Saving"
          disabled={!hasChanges || name.trim().length === 0}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}
