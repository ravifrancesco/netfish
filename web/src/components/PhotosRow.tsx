import { Link } from 'react-router';
import { Images } from 'lucide-react';
import { hasPhotos, usePhotosTop } from '../lib/photos';
import { Img } from './ui';
import { t } from '../i18n';

/** Home: the photo libraries' albums (or latest photos), as a row like the others, when there are any. */
export function PhotosRow() {
  const top = usePhotosTop().data;
  if (!hasPhotos(top)) return null;
  const tiles = top.folders.length
    ? top.folders.map((f) => ({ key: f.id, to: `/photos/${f.id}`, image: f.cover, name: f.name }))
    : top.photos.slice(0, 16).map((p) => ({ key: p.id, to: p.video ? `/watch/${p.id}` : '/photos', image: p.thumb, name: p.name }));
  return (
    <section className="row row--wide">
      <div className="row__head">
        <h2 className="row__title">
          <Link to="/photos" className="row__title-link">
            <Images size={20} aria-hidden="true" /> {t('Photos')}
          </Link>
        </h2>
      </div>
      <div className="row__viewport">
        <div className="row__track">
          {tiles.map((tile) => (
            <div key={tile.key} className="wide">
              <Link to={tile.to} className="wide__frame" aria-label={tile.name}>
                <Img src={tile.image} className="wide__img" fallback={<span className="card__fallback">{tile.name}</span>} />
              </Link>
              <div className="wide__meta">
                <div className="wide__text">
                  <span className="wide__title">{tile.name}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
