---
name: Discussion and agenda lineage
description: Rules for converting resident discussions into service requests or independently reviewed agenda proposals while preserving traceability.
---

Discussion conversions are separate workflows:

- A resident or other authorized user may create a maintenance/service request from a discussion. Preserve the discussion ID, selected source message ID when applicable, and a snapshot of the selected source text.
- An agenda proposal must go through a distinct review/approval step before it can become an official meeting agenda item.
- Creating a request must never create an agenda proposal, meeting, or vote. Creating or approving an agenda proposal must never create a request or work order.
- Preserve the chain identifiers `discussion_id`, `source_message_id`, `request_id`, `proposal_id`, `meeting_id`, and `vote_id` so Vernatun can trace both a meeting/vote path and a direct request/resolution path.

**Why:** the user asked to see a verifiable lifecycle from resident discussion through proposal, meeting, vote, decision, and possible work—or a direct discussion-to-request path without an unnecessary meeting.

**How to apply:** keep each conversion endpoint and UI action independent, enforce building/organization scope server-side, and add trace links transactionally when requests, proposals, agenda items, or ballots are created.
