import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Play, Pause, Volume2, VolumeX, Eye, EyeOff, Radio, Shuffle } from 'lucide-react';

export const DEFAULT_YOUTUBE_URL = 'https://www.youtube.com/watch?v=IJbIvkm4S_M';
export const DEFAULT_YOUTUBE_ID = 'IJbIvkm4S_M';

export function isYouTubeLink(input: string): boolean {
  const trimmed = input.trim();
  return (
    /^[a-zA-Z0-9_-]{11}$/.test(trimmed) ||
    /(?:[?&]v=|youtu\.be\/|\/embed\/)[a-zA-Z0-9_-]{11}/.test(trimmed)
  );
}

export function extractYouTubeId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_YOUTUBE_ID;

  // Match standard 11-char ID if passed directly
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.replace('/', '').slice(0, 11);
      if (id.length === 11) return id;
    }
    const vParam = url.searchParams.get('v');
    if (vParam && vParam.length >= 11) {
      return vParam.slice(0, 11);
    }
    const embedMatch = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) {
      return embedMatch[1];
    }
  } catch {
    // Fallback regex
    const match = trimmed.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
  }

  return DEFAULT_YOUTUBE_ID;
}

interface YouTubeAmbientPlayerProps {
  enabled: boolean;
  youtubeUrl: string;
  syncWithTimer: boolean;
  isTimerRunning: boolean;
  isFocusPhase: boolean;
  volume: number;
  isMaxFocusActive: boolean;
  isVideoBlockedByShield?: boolean;
  onToggleEnabled: () => void;
  onVolumeChange: (volume: number) => void;
  /** Position du morceau dans la playlist, ex. « 2/5 » */
  trackPosition?: string;
  /** Tire un autre morceau au hasard dans la playlist */
  onShuffle?: () => void;
}

export const YouTubeAmbientPlayer: React.FC<YouTubeAmbientPlayerProps> = ({
  enabled,
  youtubeUrl,
  syncWithTimer,
  isTimerRunning,
  isFocusPhase,
  volume,
  isMaxFocusActive,
  isVideoBlockedByShield = false,
  onToggleEnabled,
  onVolumeChange,
  trackPosition,
  onShuffle,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [manualPlaying, setManualPlaying] = useState<boolean>(false);
  const [showVideoFrame, setShowVideoFrame] = useState<boolean>(false);
  const [iframeReady, setIframeReady] = useState<boolean>(false);

  const videoId = useMemo(() => extractYouTubeId(youtubeUrl), [youtubeUrl]);

  // Determine whether the YouTube stream should currently be playing
  const shouldPlay = useMemo(() => {
    if (!enabled) return false;
    if (syncWithTimer) {
      return isTimerRunning && isFocusPhase;
    }
    return manualPlaying;
  }, [enabled, syncWithTimer, isTimerRunning, isFocusPhase, manualPlaying]);

  const sendPlayerCommand = (func: string, args: unknown[] = []) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      JSON.stringify({
        event: 'command',
        func,
        args,
      }),
      '*'
    );
  };

  // Control play/pause via YouTube IFrame API postMessage
  useEffect(() => {
    if (!iframeReady) return;
    if (shouldPlay) {
      sendPlayerCommand('unMute');
      sendPlayerCommand('setVolume', [volume]);
      sendPlayerCommand('playVideo');
    } else {
      sendPlayerCommand('pauseVideo');
    }
  }, [shouldPlay, iframeReady]);

  // Control volume dynamically
  useEffect(() => {
    if (!iframeReady) return;
    if (volume <= 0) {
      sendPlayerCommand('mute');
    } else {
      sendPlayerCommand('unMute');
      sendPlayerCommand('setVolume', [volume]);
    }
  }, [volume, iframeReady]);

  const handleTogglePlayPause = () => {
    if (!enabled) {
      onToggleEnabled();
      setManualPlaying(true);
      setTimeout(() => {
        sendPlayerCommand('unMute');
        sendPlayerCommand('setVolume', [volume]);
        sendPlayerCommand('playVideo');
      }, 150);
      return;
    }

    if (syncWithTimer) {
      // Allow manual override trigger even if synced
      if (shouldPlay) {
        sendPlayerCommand('pauseVideo');
      } else {
        sendPlayerCommand('unMute');
        sendPlayerCommand('setVolume', [volume]);
        sendPlayerCommand('playVideo');
      }
    } else {
      setManualPlaying((prev) => !prev);
    }
  };

  const embedSrc = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&loop=1&playlist=${videoId}&rel=0&modestbranding=1&playsinline=1`;

  return (
    <div
      className={
        isMaxFocusActive
          ? 'mt-4 flex flex-col items-center'
          : 'w-full mt-4 pt-4 border-t border-neutral-100 dark:border-slate-800/70'
      }
    >
      {/* Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 w-full">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={handleTogglePlayPause}
            aria-label={shouldPlay ? 'Mettre en pause l’ambiance sonore' : 'Lire l’ambiance sonore YouTube'}
            className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              shouldPlay
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                : 'border border-neutral-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800'
            }`}
          >
            {shouldPlay ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-current" />
                <span>Ambiance active</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Ambiance sonore</span>
              </>
            )}
          </button>

          {!isMaxFocusActive && (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
              <Radio className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono-tabular">
                {trackPosition ? `Morceau ${trackPosition}` : `ID: ${videoId}`}
              </span>
              {onShuffle && (
                <button
                  type="button"
                  onClick={onShuffle}
                  title="Morceau aléatoire suivant"
                  aria-label="Choisir un autre morceau au hasard dans la playlist"
                  className="p-1 rounded-md text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                </button>
              )}
              <span aria-hidden="true">·</span>
              <span>{syncWithTimer ? 'Synchronisée au minuteur' : 'Lecture libre'}</span>
            </div>
          )}
        </div>

        {/* Volume & Video Frame Toggle */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onVolumeChange(volume > 0 ? 0 : 50)}
              aria-label={volume === 0 ? 'Rétablir le volume d’ambiance' : 'Couper le volume d’ambiance'}
              className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              {volume === 0 ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              aria-label="Volume de l’ambiance sonore YouTube"
              className="w-20 sm:w-24 accent-slate-900 dark:accent-white cursor-pointer h-1.5 bg-neutral-200 dark:bg-slate-700 rounded-lg"
            />
            <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400 w-8 text-right">
              {volume}%
            </span>
          </div>

          {!isMaxFocusActive && !isVideoBlockedByShield && (
            <button
              type="button"
              onClick={() => setShowVideoFrame((prev) => !prev)}
              title={showVideoFrame ? 'Masquer le lecteur YouTube' : 'Afficher le lecteur YouTube'}
              className="min-h-[32px] px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {showVideoFrame ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Masquer lecteur</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Lecteur</span>
                </>
              )}
            </button>
          )}
          {!isMaxFocusActive && isVideoBlockedByShield && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Vidéo bloquée · Audio seul
            </span>
          )}
        </div>
      </div>

      {/* Persistent YouTube IFrame (visible when toggled, or visually collapsed so audio keeps playing) */}
      <div
        className={
          showVideoFrame && !isMaxFocusActive && !isVideoBlockedByShield
            ? 'mt-3 w-full overflow-hidden rounded-xl border border-neutral-200 dark:border-slate-800 bg-black aspect-video max-h-48'
            : 'sr-only pointer-events-none h-0 w-0 overflow-hidden'
        }
      >
        <iframe
          ref={iframeRef}
          src={embedSrc}
          title="Ambiance sonore YouTube"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          onLoad={() => {
            setIframeReady(true);
            sendPlayerCommand('setVolume', [volume]);
            if (shouldPlay) {
              sendPlayerCommand('unMute');
              sendPlayerCommand('playVideo');
            }
          }}
          className="w-full h-full border-0"
        />
      </div>
    </div>
  );
};
