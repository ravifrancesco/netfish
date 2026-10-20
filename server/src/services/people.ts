import type { Card, CreditKind, PersonDetail, PersonResult, SearchResponse } from '@netfish/shared';
import type { SessionUser } from '../auth';
import { CARD_FIELDS, jellyfin, type JfItem, type JfItemsResult } from '../clients/jellyfin';
import type { SeerrCredit, SeerrResult } from '../clients/seerr';
import { settle } from '../lib/async';
import { jfImage, tmdbImage } from '../lib/images';
import { HttpError } from '../lib/upstream';
import { t } from '../lib/i18n';
import { jfToCard, seerrCards, type ProgressMap } from './cards';
import { catalog } from './catalog';
import { allDownloads, progressByTitle } from './downloads';
import { hiddenIds, type LibraryIndex } from './library';
import { playableIndex } from './manage';

/**
 * Directors, actors and writers: a person's films and shows, and finding them
 * by name in search. From TMDB (through Seerr) when it's connected, so the list
 * covers everything they made, with what's in the library marked; otherwise from
 * the people Jellyfin knows in the library.
 */

const EMPTY: JfItemsResult = { Items: [], TotalRecordCount: 0 };

const SECTION_TITLE: Record<CreditKind, string> = { directed: 'Directed', acted: 'Acted in', written: 'Written', created: 'Created' };
const HEADING: Record<CreditKind, string> = {
  directed: 'Directed by {name}',
  acted: 'Starring {name}',
  written: 'Written by {name}',
  created: 'Created by {name}',
};
/** Which of someone's work comes first: what they're known for. */
const ORDER: Record<string, CreditKind[]> = {
  Directing: ['directed', 'created', 'written', 'acted'],
  Writing: ['written', 'created', 'directed', 'acted'],
  Acting: ['acted', 'directed', 'created', 'written'],
};
const DEFAULT_ORDER: CreditKind[] = ['acted', 'directed', 'created', 'written'];

// Talk shows and news: appearances, not roles. Same for playing yourself or hosting.
const APPEARANCE_GENRES = new Set([10767, 10763]);
const isAppearance = (c: SeerrCredit) =>
  /^(self|himself|herself|themselves|narrator|host|presenter|guest)\b/i.test(c.character?.trim() ?? '') ||
  (c.mediaType === 'tv' && (c.genreIds ?? []).some((g) => APPEARANCE_GENRES.has(g)));
const mostSeen = (list: SeerrCredit[]) =>
  [...list].sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0) || (b.popularity ?? 0) - (a.popularity ?? 0));
/** What can be watched right now first, each part still best-known first. */
export const watchableFirst = (cards: Card[]) => [
  ...cards.filter((c) => c.status === 'available' || c.status === 'partial'),
  ...cards.filter((c) => c.status !== 'available' && c.status !== 'partial'),
];

/** Someone's work by kind, best-known first. */
export function creditLists(credits: { cast?: SeerrCredit[]; crew?: SeerrCredit[] }): Record<CreditKind, SeerrCredit[]> {
  const cast = credits.cast ?? [];
  const crew = credits.crew ?? [];
  return {
    directed: mostSeen(crew.filter((c) => c.job === 'Director')),
    created: mostSeen(crew.filter((c) => c.job === 'Creator')),
    written: mostSeen(crew.filter((c) => c.department === 'Writing' && c.job !== 'Creator')),
    acted: mostSeen(cast.filter((c) => !isAppearance(c))),
  };
}

function tmdbSections(credits: { cast?: SeerrCredit[]; crew?: SeerrCredit[] }, department: string | undefined, index: LibraryIndex, progress: ProgressMap) {
  const lists = creditLists(credits);
  // A film they directed and wrote shows once, under what comes first for them.
  const seen = new Set<string>();
  const sections: PersonDetail['sections'] = [];
  for (const kind of ORDER[department ?? ''] ?? DEFAULT_ORDER) {
    const items = watchableFirst(seerrCards(lists[kind], index, progress)).filter((c) => !seen.has(c.key));
    items.forEach((c) => seen.add(c.key));
    if (items.length) sections.push({ kind, title: t(SECTION_TITLE[kind]), items });
  }
  return sections;
}

async function jellyfinSections(user: SessionUser, personId: string, index: LibraryIndex) {
  const excludeItemIds = await hiddenIds(user);
  const credited = (personTypes: string) =>
    settle(
      jellyfin.items(user.token, {
        userId: user.id,
        excludeItemIds,
        personIds: personId,
        personTypes,
        includeItemTypes: 'Movie,Series',
        recursive: true,
        sortBy: 'CommunityRating,SortName',
        sortOrder: 'Descending',
        fields: CARD_FIELDS,
        enableImageTypes: 'Primary,Backdrop,Thumb',
      }),
      EMPTY,
    );
  const [directed, acted, written] = await Promise.all([credited('Director'), credited('Actor,GuestStar'), credited('Writer')]);
  const lists: Record<CreditKind, JfItem[]> = { directed: directed.Items, acted: acted.Items, written: written.Items, created: [] };
  const order = directed.Items.length > acted.Items.length ? ORDER.Directing : written.Items.length > acted.Items.length ? ORDER.Writing : ORDER.Acting;
  const seen = new Set<string>();
  const sections: PersonDetail['sections'] = [];
  for (const kind of order) {
    const items = lists[kind].map((i) => jfToCard(i, index)).filter((c) => !seen.has(c.key));
    items.forEach((c) => seen.add(c.key));
    if (items.length) sections.push({ kind, title: t(SECTION_TITLE[kind]), items });
  }
  return sections;
}

export async function personDetail(user: SessionUser, id: string): Promise<PersonDetail> {
  if (id.startsWith('jf-')) {
    const personId = id.slice(3);
    const [person, index] = await Promise.all([jellyfin.item(user.token, user.id, personId), playableIndex(user)]);
    if (person.Type !== 'Person') throw new HttpError(404, t("Couldn't find that person"));
    return {
      id,
      name: person.Name,
      photo: jfImage(person.Id, 'Primary', person.ImageTags?.Primary, { maxWidth: 400 }),
      biography: person.Overview || undefined,
      born: person.PremiereDate?.slice(0, 10),
      sections: await jellyfinSections(user, personId, index),
    };
  }
  const tmdbId = Number(id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) throw new HttpError(400, t("Couldn't find that person"));
  const [person, credits, index, downloads] = await Promise.all([
    catalog.person(tmdbId),
    catalog.personCredits(tmdbId),
    playableIndex(user),
    settle(allDownloads(), []),
  ]);
  return {
    id,
    name: person.name,
    photo: tmdbImage(person.profilePath, 'w500'),
    biography: person.biography?.trim() || undefined,
    knownFor: person.knownForDepartment ? t(person.knownForDepartment) : undefined,
    born: person.birthday ?? undefined,
    died: person.deathday ?? undefined,
    birthplace: person.placeOfBirth ?? undefined,
    sections: tmdbSections(credits, person.knownForDepartment, index, progressByTitle(downloads)),
  };
}

// ---------- Search ----------

const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** "nolan", "christopher nolan" and "chris nolan" clearly mean Christopher Nolan; "christopher" or "tom" don't. */
function isTheirName(query: string, name: string): boolean {
  const q = words(query);
  const n = words(name);
  if (!q.length || q.join('').length < 4) return false;
  if (q.length === 1) return q[0] === n[n.length - 1];
  return q.every((w) => n.some((part) => part.startsWith(w))) && q.some((w) => n.includes(w));
}

const knownFor = (r: SeerrResult) =>
  [...new Set((r.knownFor ?? []).map((k) => k.title ?? k.name).filter(Boolean))].slice(0, 3).join(', ') || undefined;

/** People matching a search, and, when the search is plainly someone's name, their work. */
export async function searchPeople(
  user: SessionUser,
  query: string,
  tmdbResults: SeerrResult[] | undefined,
  index: LibraryIndex,
  progress: ProgressMap,
): Promise<Pick<SearchResponse, 'people' | 'person'>> {
  if (tmdbResults) {
    const found = tmdbResults.filter((r) => r.mediaType === 'person' && r.name);
    const people: PersonResult[] = found.slice(0, 12).map((r) => ({
      id: String(r.id),
      name: r.name!,
      photo: tmdbImage(r.profilePath, 'w185'),
      knownFor: knownFor(r),
    }));
    const match = found.slice(0, 3).find((r) => isTheirName(query, r.name!));
    if (!match) return { people };
    const [person, credits] = await Promise.all([settle(catalog.person(match.id), undefined), settle(catalog.personCredits(match.id), undefined)]);
    const first = credits && tmdbSections(credits, person?.knownForDepartment, index, progress)[0];
    if (!first) return { people };
    return { people, person: { id: String(match.id), name: match.name!, kind: first.kind, title: t(HEADING[first.kind], { name: match.name! }), items: first.items.slice(0, 18) } };
  }

  const res = await settle(jellyfin.persons(user.token, { userId: user.id, searchTerm: query, limit: 12, enableImageTypes: 'Primary' }), EMPTY);
  const people: PersonResult[] = res.Items.map((p) => ({ id: `jf-${p.Id}`, name: p.Name, photo: jfImage(p.Id, 'Primary', p.ImageTags?.Primary, { maxWidth: 185 }) }));
  // Jellyfin lists people alphabetically, not by fame: only an unambiguous name counts.
  const matches = res.Items.filter((p) => isTheirName(query, p.Name));
  const match = matches.length === 1 ? matches[0] : undefined;
  if (!match) return { people };
  const first = (await jellyfinSections(user, match.Id, index))[0];
  if (!first) return { people };
  return { people, person: { id: `jf-${match.Id}`, name: match.Name, kind: first.kind, title: t(HEADING[first.kind], { name: match.Name }), items: first.items.slice(0, 18) } };
}
