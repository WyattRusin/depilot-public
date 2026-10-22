'use client';
import { Sheet } from './Sheet';
import { Close, Plus } from './icons';
import { MAX_PHOTOS } from '@/lib/client/items';

export interface DraftPhoto { file: File; url: string }

export function NewItemSheet({ photos, onAdd, onRemove, onCreate, onClose }: {
  photos: DraftPhoto[];
  onAdd: (files: FileList | null) => void;
  onRemove: (url: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const full = photos.length >= MAX_PHOTOS;
  return (
    <Sheet title="New item" onClose={onClose}
      foot={
        <button type="button" className="btn btn-pri btn-block" onClick={onCreate} disabled={!photos.length}>
          Create item{photos.length ? ` · ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}
        </button>
      }>
      <p className="sheet-sub">Add the back, the tag and any close-ups too. Tap a photo to remove it.</p>
      <div className="slots draft-slots">
        {photos.map((p, i) => (
          <button key={p.url} type="button" className="slot" onClick={() => onRemove(p.url)} aria-label={`Remove photo ${i + 1}`}>
            <span className="slot-f" style={{ position: 'relative' }}>
              <img src={p.url} alt="" />
              <span className="slot-x"><Close /></span>
            </span>
            {`Photo ${i + 1}`}
          </button>
        ))}
        {!full && (
          <label className="slot is-empty" style={{ cursor: 'pointer' }} aria-label="Add photos">
            <span className="slot-f"><Plus /></span>Add
            <input type="file" accept="image/*" multiple className="vh" onChange={e => { onAdd(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
    </Sheet>
  );
}
