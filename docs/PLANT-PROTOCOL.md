# The Plant Protocol

The plant draws whatever answers these HTTP routes. [Paperclip](https://github.com/paperclipai/paperclip) answers all of them natively. Any other harness can be drawn by an **adapter**: something that answers the same routes with the same JSON shapes.

An adapter does not need every route. The plant works in tiers. Answer the first tier and you get a living factory. Each tier after that switches on more of the plant.

The canonical example of every response is the built-in mock, [`src/live/mock.ts`](../src/live/mock.ts). It is a complete fake Paperclip in about 700 lines, and it is what the demo runs on. One thing to know before copying it: it is stateful. Every read of the agents list moves its little story on by a step.

## Two ways in

The plant has two seams, and an adapter can use either or both.

1. **The snapshot seam (tier 1 only).** `boot()` takes a `startPoller` function. Whatever it returns emits a typed `Snapshot` (see [`src/live/types.ts`](../src/live/types.ts)): the company, the agents and their statuses, and the pending approvals. An adapter that only wants a living plant can build snapshots itself and never parse a URL. See how [`src/cockpit/dev-entry.ts`](../src/cockpit/dev-entry.ts) wires it.
2. **The fetch seam (every tier).** Every other read and write goes through `fetchImpl`, which has the shape of `fetch`:

   ```ts
   type FetchLike = (input: string, init?: RequestInit) => Promise<ResponseLike>;
   interface ResponseLike { type: string; status: number; ok: boolean; text(): Promise<string> }
   ```

   The plant sends `method`, `headers`, a JSON or `FormData` body, `credentials: 'same-origin'`, `redirect: 'manual'` and an abort `signal`. The real `fetch`, pointed at a server that speaks the protocol, works as it is.

Pass both. The default poller ([`src/live/poller.ts`](../src/live/poller.ts)) uses a `fetchImpl` too, so an adapter that answers the tier 1 routes needs nothing else.

### How the plant reads a response

| What comes back | What the plant does |
|---|---|
| 2xx with a JSON body | Uses it. |
| 401 or 403 | Shows "PAPERS, PLEASE": your sign-in has expired. |
| Any 3xx, or `type: 'opaqueredirect'` | Shows "PAPERS, PLEASE": the sign-in in front of the server has lapsed. |
| Anything else, a non-JSON body, or no answer in 20 seconds | Treats the server as unreachable for now and keeps trying. |
| An error body like `{ "error": "Issue not found" }` | Shows that reason in a sentence where it helps. |

Ids that end up in a path must be UUIDs. The plant refuses to put anything else in a URL.

## Tier 1: the living plant (required)

Comrades appear, walk to where their status puts them, and freeze in Siberia when paused or in error.

| Method | Route | Returns |
|---|---|---|
| GET | `/api/companies` | `[{ id, name }]` (or `{ data: [...] }`). The plant draws the one chosen at setup, or the first when none was chosen. A chosen company that is no longer listed is an error the owner fixes in the founding form; the plant never switches company by itself. |
| GET | `/api/companies/:companyId/agents` | `[{ id, name, title, role, status, pauseReason, errorReason, lastHeartbeatAt, reportsTo, urlKey }]` |
| GET | `/api/companies/:companyId/sidebar-badges` | `{ inbox, approvals, failedRuns, joinRequests }` (numbers). A failure keeps the last counts. |
| GET | `/api/companies/:companyId/approvals?status=pending` | `[]` is fine. Read every tick; tier 3 says what goes in it. |

**Status decides place.** `running`, or a heartbeat in the last few minutes, puts a comrade at their station. `idle` sends them to the canteen. `paused` or `error` sends them to Siberia. An unknown status is treated as idle.

**The owner's own seat.** An agent the owner picked at setup as their own (or, until they choose, one named like "Manual Seat"; nobody once they choose none) keeps the director's office whatever its status, leaves the desk to whoever works it, is never put on trial, and its board stamps stay locked.

**Name and title decide look and station.** A title or name with "Company Lead", "Boss" or "CEO" gets the director's office. When the plant needs one Company Lead (for a directive's footer, say), an agent with `role: "ceo"` wins. "Delivery Lead" or "Planner" gets the planning room. "Reviewer", "Critic", "Auditor" or "Inspector" gets the inspectorate. The full list is in [`src/live/personas.ts`](../src/live/personas.ts). Everyone else works the production floor, in an outfit seeded from their id.

## Tier 2: directives and chat

Click a comrade, type an order, read their replies.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/auth/get-session` | `{ session: { id, userId }, user: { id, name } }`. Tells your messages from everyone else's. |
| GET | `/api/companies/:companyId/issues?assigneeAgentId=:agentId&limit=50` | A comrade's threads. |
| POST | `/api/companies/:companyId/issues` | A new directive: `{ title, description, assigneeAgentId, status: "todo" }`. |
| GET | `/api/issues/:issueId` | One thread. |
| GET | `/api/issues/:issueId/comments?order=asc` | Its messages, oldest first. |
| GET | `/api/issues/:issueId/comments?order=desc&limit=5` | The newest few, to notice replies. |
| POST | `/api/issues/:issueId/comments` | A reply: `{ body, clientRequestId }`, plus `attachmentIds` and `reopen` when needed. |
| POST | `/api/issues/:issueId/read` | Marks a thread read. |
| GET, POST | `/api/companies/:companyId/chats/:agentId` | Optional: one running conversation per comrade. A 404 whose error says "Route not found" hides the chat tab. |
| GET, POST | `/api/issues/:issueId/interactions`, `/api/issues/:issueId/interactions/:id/:kind` | Optional: questions a comrade asks you, answered with stamps. |
| GET | `/api/issues/:issueId/attachments`, `/api/attachments/:id/content?download=1` | Optional: files on messages. |
| POST | `/api/companies/:companyId/issues/:issueId/attachments` | Optional: attach a file (`FormData`). |

## Tier 3: approvals (hires, tribunals, dossiers)

Trains bring hires, the court sits, and you stamp ОДОБРЕНО or ОТКАЗАНО.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/companies/:companyId/approvals?status=pending` | `[{ id, type, status, payload, requestedByAgentId, createdAt }]` |
| GET | `/api/companies/:companyId/approvals?status=approved` | Recent decisions, so a verdict given elsewhere is carried out. |
| GET | `/api/approvals/:approvalId` | Re-read before a dossier stamp acts, and when a tribunal opens. |
| POST | `/api/approvals/:approvalId/approve`, `/reject`, `/request-revision` | `{ decisionNote }` |
| GET | `/api/agents/:agentId` | Re-read a comrade before acting on them. |
| POST | `/api/agents/:agentId/terminate` | After a guilty verdict. Irreversible. |
| GET | `/api/companies/:companyId/activity?entityType=approval&entityId=:id&limit=500` | Who really filed an approval. Tribunals stay locked without it. |

The plant understands three kinds of approval:

- **`hire_agent`**: a hire, who arrives by train. The payload names the new agent with `agentId`.
- **A tribunal referral**: `type: "request_board_approval"` with the payload below. The stamps unlock only for one the Director of Operational Hygiene filed, according to the activity record rather than the payload.

  ```json
  {
    "tribunal": true,
    "agentId": "uuid of the accused",
    "agentName": "Shock Worker No. 3",
    "strikes": 3,
    "probation": false,
    "reportIssueId": "uuid of the Director's report issue",
    "charge": "Shipped work without running the tests, three times in eleven days.",
    "strikeList": [
      { "date": "2026-09-12", "finding": "Merged a change with failing tests.", "serious": false }
    ]
  }
  ```

- **Anything else**: a dossier, carried by whoever filed it.

## Tier 4: the extras

| Method | Route | Switches on |
|---|---|---|
| GET | `/api/companies/:companyId/activity?limit=n` | Pravda, the paper that greets you after time away. |
| GET | `/api/companies/:companyId/heartbeat-runs?agentId=:agentId&limit=n` | The Personnel File's recent shifts. |
| POST | `/api/agents/:agentId/pause`, `/resume`, `/wakeup`, `/clear-error` | The board stamps on the Personnel File. |
| GET | `/api/companies/:companyId/routines` | The inspection's routine stamp: `[{ title, assigneeAgentId, status }]`. A 404 here makes that stamp "check by hand". |
| GET | `/api/companies/:companyId/issues?q=:title&limit=50`, `/api/issues/:issueId` | The inspection's ledger and Lessons stamps, and the threshold on the first line of the ledger's `description`. Each is found once by its title, then read by id. An issue counts only when its `companyId` is the company drawn. A failed read keeps the last verdict. |

The inspection is the last page of the founding form. It checks that the Ministry of Operational Hygiene is set up as [ONBOARDING.md](ONBOARDING.md) asks, and swaps the "Ministry not yet founded" poster in the director's office for a plaque once it is.

## What the plant never does

- It never shows text with `innerHTML`. Everything an adapter returns is treated as untrusted.
- It never sends a dossier decision without re-reading the dossier, and a tribunal stays locked until the activity record shows the Director filed it.
- It never stores credentials. Sign-in is whatever the browser already carries to your server.
