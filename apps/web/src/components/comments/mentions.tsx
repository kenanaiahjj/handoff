"use client";

import { createContext, Fragment, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type MentionPerson = { id: string; name: string; email: string };

const MentionContext = createContext<MentionPerson[]>([]);

/** Loads the people who can be @mentioned on this handoff, once, for every comment box inside. */
export function MentionProvider({ endpoint, children }: { endpoint: string | null; children: ReactNode }) {
  const [people, setPeople] = useState<MentionPerson[]>([]);
  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    fetch(endpoint)
      .then((response) => (response.ok ? response.json() : { people: [] }))
      .then((payload: { people?: MentionPerson[] }) => {
        if (!cancelled) setPeople(Array.isArray(payload.people) ? payload.people : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [endpoint]);
  return <MentionContext.Provider value={people}>{children}</MentionContext.Provider>;
}

export function useMentionPeople() {
  return useContext(MentionContext);
}

const mentionToken = /@\[([^\]\n]{1,80})\]\(user:([A-Za-z0-9_-]{1,64})\)/g;

/** Comment text with "@[Name](user:id)" shown as a highlighted "@Name". */
export function CommentBody({ body }: { body: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(mentionToken)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(<Fragment key={`t${last}`}>{body.slice(last, index)}</Fragment>);
    parts.push(
      <span className="comment-mention" key={`m${index}`}>
        @{match[1]}
      </span>,
    );
    last = index + match[0].length;
  }
  if (last < body.length) parts.push(<Fragment key={`t${last}`}>{body.slice(last)}</Fragment>);
  return <>{parts}</>;
}

/** The "@query" being typed right before the caret, if any. */
export function activeMentionQuery(text: string, caret: number) {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\p{L}\p{N}._-]{0,40})$/u.exec(before);
  return match ? { query: match[2], start: caret - match[2].length - 1 } : null;
}

/**
 * Turns the readable "@Name" text the person typed into saved mention tokens, for the people they
 * picked from the list. Anything else that starts with "@" stays plain text.
 */
export function encodeMentions(text: string, picked: MentionPerson[]) {
  let encoded = text;
  // Longest names first so "@Ana Cruz" wins over "@Ana".
  for (const person of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    const escaped = person.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    encoded = encoded.replace(new RegExp(`@${escaped}(?![\\p{L}\\p{N}])`, "gu"), `@[${person.name}](user:${person.id})`);
  }
  return encoded;
}

/** Up to six people whose name or email starts with (or contains) the query. */
export function useMentionMatches(query: string | null) {
  const people = useMentionPeople();
  return useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    const starts = people.filter((person) => person.name.toLowerCase().startsWith(needle) || person.email.toLowerCase().startsWith(needle));
    const contains = people.filter((person) => !starts.includes(person) && person.name.toLowerCase().includes(needle));
    return [...starts, ...contains].slice(0, 6);
  }, [people, query]);
}
