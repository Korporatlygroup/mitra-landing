import mediaJson from '../../content/media.json';

export type MediaItem = {
  id: string;
  section: string;
  type: 'image' | 'video' | 'logo';
  file?: string;
  file_sm?: string;
  poster?: string;
  w?: number | null;
  h?: number | null;
  alt: string;
  description?: string;
  consent?: 'pending' | 'confirmed' | 'not-needed';
  notes?: string;
};

const items = new Map<string, MediaItem>(
  (mediaJson.items as MediaItem[]).map((m) => [m.id, m]),
);

// Files under public/, listed at build time in astro.config.mjs (no filesystem access here, so this works
// whatever the host's build cwd or runtime).
declare const __PUBLIC_FILES__: string[];
const publicFiles = new Set(__PUBLIC_FILES__);
const onDisk = (file?: string) => !!file && publicFiles.has(file);

/** Looks up a media.json entry and whether its optimised file exists in public/. */
export function getMedia(id?: string | null) {
  const item = id ? items.get(id) : undefined;
  return {
    item,
    available: !!item && onDisk(item.file),
    hasSmall: !!item && onDisk(item.file_sm),
    hasPoster: !!item && onDisk(item.poster),
  };
}

/** Root-relative URL for a file under public/. */
export const url = (file: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${file}`;
