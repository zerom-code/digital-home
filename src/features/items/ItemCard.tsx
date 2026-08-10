import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { signedUrl } from '@/lib/supabase/client';
import type { Item } from '@/lib/supabase/types';
import { computeWarranty } from '@/lib/warranty';

/**
 * Плитка вещи в сетке комнаты.
 *
 * Фото важнее текста: человек узнаёт свой холодильник по картинке быстрее,
 * чем читает «Samsung RB37J5000SA».
 */
export function ItemTile({ item }: { item: Item }) {
  const photo = useSignedPhoto(item.photo_path);
  const warranty = computeWarranty(item);

  return (
    <Link
      to={`/item/${item.id}`}
      className="flex flex-col overflow-hidden rounded-card border border-line bg-surface active:bg-surface-2"
    >
      <div className="flex aspect-4/3 items-center justify-center bg-surface-2">
        {photo ? (
          <img src={photo} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <span className="text-3xl opacity-40" aria-hidden="true">📦</span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 p-3">
        <span className="font-medium text-ink line-clamp-2">{item.name}</span>
        {item.brand && <span className="text-xs text-ink-3">{item.brand}</span>}
        {warranty.state === 'expiring' && (
          <span className="mt-1 text-xs font-medium text-warn">⚠ гарантия на исходе</span>
        )}
      </div>
    </Link>
  );
}

/**
 * Ссылка на файл в приватном бакете живёт час, поэтому её нельзя ни
 * сохранить в базу, ни закешировать надолго — запрашиваем при показе.
 */
export function useSignedPhoto(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    void signedUrl(path).then((result) => {
      if (alive) setUrl(result);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  return url;
}
