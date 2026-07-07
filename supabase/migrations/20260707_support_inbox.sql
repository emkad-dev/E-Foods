-- Support inbox: conversations + messages (Phase 1)
create table if not exists public."SupportConversation" (
  "id"            text primary key,
  "customerId"    text not null unique,
  "subject"       text,
  "status"        text not null default 'open',
  "assignedTo"    text,
  "channel"       text not null default 'in_app',
  "lastMessageAt" timestamptz not null default now(),
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);

create table if not exists public."SupportMessage" (
  "id"             text primary key,
  "conversationId" text not null references public."SupportConversation"("id") on delete cascade,
  "senderType"     text not null,
  "senderId"       text,
  "body"           text not null,
  "emailSent"      boolean not null default false,
  "pushSent"       boolean not null default false,
  "createdAt"      timestamptz not null default now()
);

create index if not exists "SupportConversation_status_idx" on public."SupportConversation" ("status");
create index if not exists "SupportConversation_assignedTo_idx" on public."SupportConversation" ("assignedTo");
create index if not exists "SupportConversation_lastMessageAt_idx" on public."SupportConversation" ("lastMessageAt");
create index if not exists "SupportMessage_conversationId_idx" on public."SupportMessage" ("conversationId");
create index if not exists "SupportMessage_createdAt_idx" on public."SupportMessage" ("createdAt");

-- No policies: anon/authenticated get zero rows. app-rpc uses the service role,
-- which bypasses RLS. All support access is mediated by the edge function.
alter table public."SupportConversation" enable row level security;
alter table public."SupportMessage" enable row level security;
