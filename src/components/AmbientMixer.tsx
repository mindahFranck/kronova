import React, { useEffect, useRef, useState } from 'react';
import { CloudRain, Waves, Flame, Coffee, Volume2, VolumeX, Play, Pause, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AmbientMix } from '../types';
import { AmbientEngine, type AmbientTrackId } from '../utils/ambientEngine';

interface AmbientMixerProps {
  /** Mixeur activé par l'utilisateur */
  enabled: boolean;
  /** Vrai quand le minuteur tourne en phase de concentration (décidé par le parent) */
  shouldPlay: boolean;
  mix: AmbientMix;
  onMixChange: (mix: AmbientMix) => void;
  onToggleEnabled: () => void;
  /** Si vrai, rien n'est affiché mais la lecture continue */
  isMaxFocusActive: boolean;
}

const TRACKS: { id: AmbientTrackId; label: string; Icon: LucideIcon }[] = [
  { id: 'rain', label: 'Pluie douce', Icon: CloudRain },
  { id: 'brown', label: 'Bruit brun', Icon: Waves },
  { id: 'fire', label: 'Cheminée', Icon: Flame },
  { id: 'cafe', label: 'Café calme', Icon: Coffee },
];

const DEFAULT_UNMUTE_VOLUME = 40;

export const AmbientMixer: React.FC<AmbientMixerProps> = ({
  enabled,
  shouldPlay,
  mix,
  onMixChange,
  onToggleEnabled,
  isMaxFocusActive,
}) => {
  const engineRef = useRef<AmbientEngine | null>(null);
  // Dernier volume non nul de chaque piste, pour restaurer après un « muet »
  const lastVolumesRef = useRef<Partial<AmbientMix>>({});
  const [previewing, setPreviewing] = useState(false);

  // Le contexte audio n'est créé qu'au premier play() (contrainte autoplay)
  const getEngine = () => {
    if (!engineRef.current) engineRef.current = new AmbientEngine();
    return engineRef.current;
  };

  const isActive = (enabled && shouldPlay) || previewing;

  useEffect(() => {
    getEngine().setVolumes(mix);
  }, [mix]);

  useEffect(() => {
    const engine = getEngine();
    if (isActive) {
      engine.setVolumes(mix);
      void engine.play();
    } else {
      engine.pause();
    }
    // `mix` est appliqué par l'effet précédent
  }, [isActive]);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  if (isMaxFocusActive) return null;

  const setTrackVolume = (id: AmbientTrackId, volume: number) => {
    onMixChange({ ...mix, [id]: volume });
  };

  const toggleMute = (id: AmbientTrackId) => {
    if (mix[id] > 0) {
      lastVolumesRef.current[id] = mix[id];
      setTrackVolume(id, 0);
    } else {
      setTrackVolume(id, lastVolumesRef.current[id] || DEFAULT_UNMUTE_VOLUME);
    }
  };

  const allSilent = TRACKS.every(({ id }) => mix[id] <= 0);

  return (
    <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal
              className={`w-4 h-4 shrink-0 ${
                isActive && !allSilent
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            />
            <h2 id="ambient-mixer-title" className="text-sm font-semibold text-slate-900 dark:text-white">
              Mixeur d’ambiances
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {previewing
              ? 'Aperçu en cours…'
              : enabled
                ? 'Se lance automatiquement pendant les phases de concentration.'
                : 'Sons générés localement, sans connexion.'}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Activer le mixeur d’ambiances pendant la concentration"
          onClick={onToggleEnabled}
          className={`w-11 h-6 rounded-full transition-colors p-0.5 cursor-pointer shrink-0 ${
            enabled ? 'bg-slate-900 dark:bg-white' : 'bg-neutral-200 dark:bg-slate-700'
          }`}
        >
          <span
            className={`block w-5 h-5 rounded-full bg-white dark:bg-slate-900 transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <ul className="mt-4 space-y-3" aria-labelledby="ambient-mixer-title">
        {TRACKS.map(({ id, label, Icon }) => {
          const volume = mix[id];
          const muted = volume <= 0;
          const inputId = `ambient-${id}`;
          return (
            <li key={id} className="flex items-center gap-3">
              <Icon
                aria-hidden="true"
                className={`w-4 h-4 shrink-0 ${
                  muted ? 'text-slate-300 dark:text-slate-600' : 'text-slate-600 dark:text-slate-300'
                }`}
              />
              <label
                htmlFor={inputId}
                className="text-xs text-slate-700 dark:text-slate-300 w-24 shrink-0 truncate"
              >
                {label}
              </label>
              <input
                id={inputId}
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => setTrackVolume(id, Number(e.target.value))}
                aria-label={`Volume : ${label}`}
                aria-valuetext={`${volume} %`}
                className="flex-1 min-w-0 accent-slate-900 dark:accent-white cursor-pointer h-1.5 bg-neutral-200 dark:bg-slate-700 rounded-lg"
              />
              <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400 w-9 text-right">
                {volume}%
              </span>
              <button
                type="button"
                onClick={() => toggleMute(id)}
                aria-label={muted ? `Rétablir : ${label}` : `Couper : ${label}`}
                aria-pressed={muted}
                className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setPreviewing((prev) => !prev)}
          aria-pressed={previewing}
          className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
            previewing
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
              : 'border border-neutral-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800'
          }`}
        >
          {previewing ? (
            <>
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>Arrêter l’aperçu</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Écouter un aperçu</span>
            </>
          )}
        </button>
        {allSilent && (
          <span className="text-xs text-slate-400 dark:text-slate-500">Toutes les pistes sont muettes</span>
        )}
      </div>
    </div>
  );
};
