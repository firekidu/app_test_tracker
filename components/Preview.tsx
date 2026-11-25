'use client';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Image as ImageIcon, Maximize, Pause, Play, Trash2, Video, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaSummary, Row } from '@/lib/types';
import { fmtBytes, fmtDuration, prettyDate, trapTab } from './ui';

function VideoPlayer({ m }: { m: MediaSummary }) {
  const v = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(m.durationS ?? 0);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        if (el.paused) void el.play();
        else el.pause();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div className="vwrap" ref={wrap}>
      <video
        ref={v}
        src={`/api/media/${m.fileId}/view`}
        preload="metadata"
        playsInline
        poster={m.hasThumb ? `/api/media/${m.fileId}/thumb` : undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setD(e.currentTarget.duration)}
        onClick={(e) => (e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause())}
      />
      <div className="vctl">
        <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (v.current!.paused ? void v.current!.play() : v.current!.pause())}>
          {playing ? <Pause className="icon" /> : <Play className="icon" />}
        </button>
        <span className="time">
          {fmtDuration(t)} / {fmtDuration(d)}
        </span>
        <input
          type="range"
          min={0}
          max={d || 0}
          step={0.1}
          value={Math.min(t, d || 0)}
          aria-label="Seek"
          onChange={(e) => {
            const nt = Number(e.target.value);
            v.current!.currentTime = nt;
            setT(nt);
          }}
        />
        <button
          type="button"
          aria-label={muted ? 'Unmute' : 'Mute'}
          onClick={() => {
            v.current!.muted = !muted;
            setMuted(!muted);
          }}
        >
          {muted ? <VolumeX className="icon" /> : <Volume2 className="icon" />}
        </button>
        <button type="button" aria-label="Full screen" onClick={() => void (v.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).requestFullscreen?.().catch(() => (v.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.())}>
          <Maximize className="icon" />
        </button>
      </div>
    </div>
  );
}

export default function Preview({
  row,
  media,
  index,
  onIndex,
  onClose,
  canEdit,
  canDelete,
  isAdmin,
  onDelete,
  onCaption,
}: {
  row: Row;
  media: MediaSummary[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  canEdit: boolean;
  canDelete: (m: MediaSummary) => boolean;
  isAdmin: boolean;
  onDelete: (m: MediaSummary) => void;
  onCaption: (m: MediaSummary, caption: string) => Promise<void>;
}) {
  const m = media[index];
  const root = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(false);
  const [caption, setCaption] = useState(m?.caption ?? '');
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setCaption(m?.caption ?? '');
    setZoom(false);
  }, [m?.fileId, m?.caption]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') onIndex((index - 1 + media.length) % media.length);
      else if (e.key === 'ArrowRight') onIndex((index + 1) % media.length);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [index, media.length, onIndex, onClose]);

  if (!m) return null;
  const folderUrl = row.mediaFolderUrl;
  return (
    <div
      className="preview"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${m.name}`}
      ref={root}
      tabIndex={-1}
      onKeyDown={(e) => e.key === 'Tab' && trapTab(e, root.current)}
    >
      <div className="pv-top">
        <div style={{ minWidth: 0 }}>
          <div className="t1">
            {m.kind === 'video' ? <Video className="icon" /> : <ImageIcon className="icon" />}
            <span className="nm">{m.name}</span>
            <span className="mono" style={{ color: '#9aa4b5', fontWeight: 400, fontSize: 12 }}>
              {index + 1} of {media.length}
            </span>
          </div>
          <div className="t2">
            Row {row.rowNumber} · {row.title}
          </div>
        </div>
        <div className="r">
          <a className="icon-btn" href={`/api/media/${m.fileId}/download`} aria-label="Download" title="Download">
            <Download className="icon" />
          </a>
          {isAdmin && folderUrl && (
            <a className="icon-btn" href={folderUrl} target="_blank" rel="noopener noreferrer" aria-label="Open in Drive" title="Open in Drive">
              <ExternalLink className="icon" />
            </a>
          )}
          {canDelete(m) && (
            <button type="button" className="icon-btn danger" onClick={() => onDelete(m)} aria-label="Delete" title="Delete">
              <Trash2 className="icon" />
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close preview" title="Close">
            <X className="icon" />
          </button>
        </div>
      </div>
      <div
        className="pv-stage"
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const s = touch.current;
          touch.current = null;
          if (!s || zoom) return;
          const dx = e.changedTouches[0].clientX - s.x;
          const dy = e.changedTouches[0].clientY - s.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) onIndex(dx < 0 ? (index + 1) % media.length : (index - 1 + media.length) % media.length);
          else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
        }}
      >
        {media.length > 1 && (
          <button type="button" className="pv-arrow l" aria-label="Previous" onClick={() => onIndex((index - 1 + media.length) % media.length)}>
            <ChevronLeft />
          </button>
        )}
        {m.kind === 'video' ? (
          <VideoPlayer key={m.fileId} m={m} />
        ) : (
           
          <img key={m.fileId} src={`/api/media/${m.fileId}/view`} alt={m.caption || m.name} className={zoom ? 'zoom' : ''} onDoubleClick={() => setZoom((z) => !z)} onClick={(e) => e.detail === 1 && zoom && setZoom(false)} draggable={false} />
        )}
        {media.length > 1 && (
          <button type="button" className="pv-arrow r" aria-label="Next" onClick={() => onIndex((index + 1) % media.length)}>
            <ChevronRight />
          </button>
        )}
      </div>
      <div className="pv-bottom">
        <div className="strip" role="list">
          {media.map((x, i) => (
            <button type="button" key={x.fileId} className={i === index ? 'cur' : ''} onClick={() => onIndex(i)} aria-label={`${x.name}${i === index ? ' (current)' : ''}`} aria-current={i === index}>
              {x.hasThumb ? (
                 
                <img src={`/api/media/${x.fileId}/thumb`} alt="" />
              ) : x.kind === 'video' ? (
                <Video className="icon" />
              ) : (
                <ImageIcon className="icon" />
              )}
            </button>
          ))}
        </div>
        <div className="pv-cap">
          <input
            aria-label="Caption"
            placeholder={canEdit ? 'Add a caption…' : 'No caption'}
            value={caption}
            readOnly={!canEdit}
            maxLength={500}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => {
              if (canEdit && caption !== (m.caption ?? '')) void onCaption(m, caption);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="m mono">
            {fmtBytes(m.size)} · uploaded by {m.uploaderName || m.uploaderUsername || 'unknown'} · {prettyDate(m.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
