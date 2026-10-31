# Monotes

A local-first notes app edited with Vim. Notes can stay on one device, sync through a person's cloud account, or be connected so coding agents can read and edit them live.

## Language

**Note**:
A single piece of Markdown text belonging to a person, identified by its slug.

**Owner**:
Whose note it is on this device: a signed-in account or the Local user. Each owner has a separate space, and a note's owner is independent of whether it is Local only or Synced.
_Avoid_: Author, user

**Local user**:
The owner of notes created by someone who has not signed in on this device.
_Avoid_: Anonymous, guest

**Current owner**:
The owner whose space this device is showing. It changes only on a confirmed sign-in or an explicit sign-out.

**Ordinary note**:
A note that is not connected for agents. It is either Local only or Synced.
_Avoid_: Scratch note, local note, legacy note

**Local only**:
The state of an ordinary note that exists only on this device.

**Synced**:
The state of an ordinary note that also has a copy in the person's cloud account.
_Avoid_: Cloud note

**Connected note**:
A note edited through collaboration, where the server holds the authoritative history and agents may be granted access.
_Avoid_: Collab note, shared note

**Kept text**:
Text Monotes set aside on this device instead of merging or discarding it, for the person to review.
_Avoid_: Recovery, recovery copy
