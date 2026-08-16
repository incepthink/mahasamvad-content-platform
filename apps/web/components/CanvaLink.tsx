import { posterCanvaUrl } from '../lib/api';
import { STR } from '../lib/strings';

export function CanvaLink({ generationId }: { generationId: string }) {
  return (
    <a
      className="icon-btn canva-link"
      href={posterCanvaUrl(generationId)}
      target="_blank"
      rel="noopener noreferrer"
      title={STR.iconOpenPosterInCanva}
      aria-label={STR.iconOpenPosterInCanva}
    >
      <img src="/canva.png" alt="" width={18} height={18} aria-hidden="true" />
      <span>Canva</span>
    </a>
  );
}
