"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Dialog,
  DialogAction,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/sodium/ui/dialog";
import { Button } from "@/components/sodium/ui/button";
import { toast } from "@/components/sodium/ui/toast";
import { Icon, Document } from "@/components/sodium/icon";
import { useClaimedAccount } from "@/contexts/upload-queue-context";
import { bringLocalNotes, countLocalUserNotes } from "@/lib/local-notes";

const OFFERED_PREFIX = "monotes-local-notes-offered:";

const countLabel = (count: number) => (count === 1 ? "1 note" : `${count} notes`);

function firstOffer(account: string) {
  try {
    if (localStorage.getItem(OFFERED_PREFIX + account)) return false;
    localStorage.setItem(OFFERED_PREFIX + account, "1");
    return true;
  } catch {
    return false;
  }
}

/*
 * After signing in, notes written without an account would otherwise seem to
 * vanish. Offered once, then kept reachable here until they're brought in.
 */
export default function LocalNotesOffer() {
  const account = useClaimedAccount();
  const count = useLiveQuery(async () => (account ? countLocalUserNotes() : 0), [account]) ?? 0;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (account && count > 0 && firstOffer(account)) setOpen(true);
  }, [account, count]);

  if (!account || count === 0) return null;

  const bringIn = async () => {
    const brought = await bringLocalNotes(account);
    toast.success(`${countLabel(brought)} brought into your account`);
  };

  return (
    <>
      <Button variant="ghost" className="mb-2 w-full justify-start" onClick={() => setOpen(true)}>
        <Icon icon={Document} />
        <span className="min-w-0 truncate">{countLabel(count)} on this device</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Bring in notes from this device?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>
              {countLabel(count)} written on this device without signing in {count === 1 ? "isn’t" : "aren’t"} part of
              this account. Bringing {count === 1 ? "it" : "them"} in shows {count === 1 ? "it" : "them"} here. Nothing
              is uploaded: {count === 1 ? "it stays" : "they stay"} Local only until you sync.
            </DialogDescription>
          </DialogBody>
          <DialogFooter>
            <DialogClose>Not now</DialogClose>
            <DialogAction onAction={bringIn} pendingLabel="Bringing in">
              Bring in
            </DialogAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
