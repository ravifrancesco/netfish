import { Fragment } from 'react';
import { Link } from 'react-router';
import type { Person, PersonResult } from '@netfish/shared';
import { Img } from './ui';

export const personHref = (id: string) => `/person/${encodeURIComponent(id)}`;

/** Round photos in a row; each opens the person's page when Netfish knows who they are. */
export function PeopleRow({ people }: { people: Array<Person | PersonResult> }) {
  return (
    <div className="people">
      {people.map((p, i) => {
        const line = 'role' in p ? p.role : 'knownFor' in p ? p.knownFor : undefined;
        const body = (
          <>
            <Img src={p.photo} className="person__img" fallback={<span>{p.name[0]}</span>} />
            <span className="person__name">{p.name}</span>
            {line && <span className="person__role">{line}</span>}
          </>
        );
        return p.id ? (
          <Link key={`${p.id}-${i}`} to={personHref(p.id)} className="person person--link">
            {body}
          </Link>
        ) : (
          <div key={`${p.name}-${i}`} className="person">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** "Jonah Pike, Ada Fisher", each name opening that person's page. */
export function NameLinks({ people }: { people: Person[] }) {
  return (
    <>
      {people.map((p, i) => (
        <Fragment key={`${p.id ?? p.name}-${i}`}>
          {i > 0 && ', '}
          {p.id ? (
            <Link to={personHref(p.id)} className="name-link">
              {p.name}
            </Link>
          ) : (
            p.name
          )}
        </Fragment>
      ))}
    </>
  );
}
