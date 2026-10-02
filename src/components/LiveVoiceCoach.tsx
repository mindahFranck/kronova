import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, MicOff, Volume2, Loader2, Radio } from 'lucide-react';

/** Commandes vocales que l'assistant peut déclencher (function calling Gemini Live). */
export type VoiceCommandName =
  | 'start_focus'
  | 'pause_timer'
  | 'resume_timer'
  | 'skip_phase'
  | 'reset_timer'
  | 'start_break'
  | 'add_task'
  | 'complete_task'
  | 'get_status';

/**
 * Résultat renvoyé à l'assistant. `ok` et `error` guident sa réponse ;
 * `summary` (optionnel) alimente le journal visible sous la carte.
 */
export type VoiceCommandResult = Record<string, unknown>;

interface LiveVoiceCoachProps {
  currentTaskTitle: string | null;
  currentPhaseLabel: string;
  isMaxFocusActive: boolean;
  authToken: string | null;
  onVoiceCommand?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<VoiceCommandResult> | VoiceCommandResult;
}

interface VoiceLogEntry {
  key: number;
  ok: boolean;
  text: string;
}

function float32ToPcm16Base64(float32Array: Float32Array): string {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

function pcm16Base64ToFloat32(base64: string): Float32Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 32768.0;
  }
  return float32;
}

export const LiveVoiceCoach: React.FC<LiveVoiceCoachProps> = ({
  currentTaskTitle,
  currentPhaseLabel,
  isMaxFocusActive,
  authToken,
  onVoiceCommand,
}) => {
  const [voiceLog, setVoiceLog] = useState<VoiceLogEntry[]>([]);
  const onVoiceCommandRef = useRef(onVoiceCommand);
  onVoiceCommandRef.current = onVoiceCommand;
  const logKeyRef = useRef(0);

  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isModelSpeaking, setIsModelSpeaking] = useState<boolean>(false);
  const [selectedVoice, setSelectedVoice] = useState<string>('Zephyr');

  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef<number>(0);

  const stopAllPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already stopped sources
      }
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0;
    setIsModelSpeaking(false);
  }, []);

  const cleanupSession = useCallback(() => {
    stopAllPlayback();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }

    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }
  }, [stopAllPlayback]);

  useEffect(() => {
    return () => {
      cleanupSession();
    };
  }, [cleanupSession]);

  const playAudioChunk = useCallback((base64Audio: string) => {
    const outCtx = outputAudioCtxRef.current;
    if (!outCtx) return;

    const float32Data = pcm16Base64ToFloat32(base64Audio);
    if (float32Data.length === 0) return;

    const audioBuffer = outCtx.createBuffer(1, float32Data.length, 24000);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = outCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outCtx.destination);

    const now = outCtx.currentTime;
    const startAt = Math.max(now, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.push(source);
    setIsModelSpeaking(true);

    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
      if (activeSourcesRef.current.length === 0) {
        setIsModelSpeaking(false);
      }
    };
  }, []);

  const handleToolCall = async (
    ws: WebSocket,
    call: { id?: unknown; name?: unknown; args?: unknown }
  ) => {
    if (typeof call.id !== 'string' || typeof call.name !== 'string') return;
    const args =
      call.args && typeof call.args === 'object' && !Array.isArray(call.args)
        ? (call.args as Record<string, unknown>)
        : {};
    const handler = onVoiceCommandRef.current;
    let response: VoiceCommandResult;
    if (!handler) {
      response = { ok: false, error: 'commande non disponible' };
    } else {
      try {
        const result = await handler(call.name, args);
        response = result && typeof result === 'object' ? result : { ok: true };
      } catch (err) {
        response = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    if (typeof response.summary === 'string' && response.summary.trim()) {
      const entry: VoiceLogEntry = {
        key: ++logKeyRef.current,
        ok: response.ok !== false,
        text: response.summary.trim().slice(0, 140),
      };
      setVoiceLog((prev) => [entry, ...prev].slice(0, 3));
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ toolResponse: { id: call.id, name: call.name, response } }));
    }
  };

  const startLiveConversation = async () => {
    setErrorMessage(null);
    setStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      const inputCtx = new AudioContextClass({ sampleRate: 16000 });
      const outputCtx = new AudioContextClass({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({
        task: currentTaskTitle || 'Session libre',
        phase: currentPhaseLabel,
        voice: selectedVoice,
        token: authToken || '',
      });
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/live?${params.toString()}`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            status?: string;
            audio?: string;
            interrupted?: boolean;
            error?: string;
            toolCall?: { id?: unknown; name?: unknown; args?: unknown };
          };

          if (msg.toolCall) {
            void handleToolCall(ws, msg.toolCall);
            return;
          }

          if (msg.error) {
            setErrorMessage(msg.error);
            setStatus('error');
            cleanupSession();
            return;
          }

          if (msg.status === 'connected') {
            setStatus('connected');

            // Start streaming microphone PCM chunks
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (ws.readyState !== WebSocket.OPEN) return;
              const channelData = e.inputBuffer.getChannelData(0);
              const base64 = float32ToPcm16Base64(channelData);
              ws.send(JSON.stringify({ audio: base64 }));
            };

            source.connect(processor);
            processor.connect(inputCtx.destination);
          }

          if (msg.interrupted) {
            stopAllPlayback();
          }

          if (msg.audio) {
            playAudioChunk(msg.audio);
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onerror = () => {
        setErrorMessage('Connexion WebSocket Live interrompue.');
        setStatus('error');
        cleanupSession();
      };

      ws.onclose = () => {
        setStatus((prev) => (prev === 'error' ? 'error' : 'idle'));
        cleanupSession();
      };
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Accès au microphone refusé par le navigateur.'
          : 'Impossible d’accéder au microphone pour la conversation vocale.';
      setErrorMessage(msg);
      setStatus('error');
      cleanupSession();
    }
  };

  const handleToggleLive = () => {
    if (status === 'connected' || status === 'connecting') {
      cleanupSession();
      setStatus('idle');
    } else {
      startLiveConversation();
    }
  };

  if (isMaxFocusActive) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-slate-800 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radio
              className={`w-4 h-4 shrink-0 ${
                status === 'connected'
                  ? 'text-emerald-600 dark:text-emerald-400 animate-pulse'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Assistant vocal IA
            </h2>
            <span aria-hidden="true" className="text-xs text-slate-400">
              ·
            </span>
            <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
              gemini-3.8-live
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {status === 'connected'
              ? isModelSpeaking
                ? 'L’assistant vous répond en direct…'
                : 'Micro ouvert — parlez de ce que vous voulez : une œuvre, une idée, une question…'
              : 'Discutez librement à la voix avec l’IA, sur n’importe quel sujet.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {status === 'idle' || status === 'error' ? (
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              aria-label="Voix de l’assistant Gemini Live"
              className="min-h-[38px] px-2.5 py-1.5 rounded-xl border border-neutral-200 dark:border-slate-800 bg-neutral-50 dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
            >
              <option value="Zephyr">Voix : Zephyr</option>
              <option value="Kore">Voix : Kore</option>
              <option value="Puck">Voix : Puck</option>
              <option value="Charon">Voix : Charon</option>
              <option value="Fenrir">Voix : Fenrir</option>
            </select>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 px-2">
              <Volume2 className="w-3.5 h-3.5" />
              <span>{isModelSpeaking ? 'Réponse audio' : 'À l’écoute'}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleToggleLive}
            className={`min-h-[38px] px-4 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer ${
              status === 'connected'
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : status === 'connecting'
                ? 'bg-neutral-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200'
            }`}
          >
            {status === 'connecting' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Connexion...</span>
              </>
            ) : status === 'connected' ? (
              <>
                <MicOff className="w-3.5 h-3.5" />
                <span>Terminer l’appel</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5" />
                <span>Démarrer la voix</span>
              </>
            )}
          </button>
        </div>
      </div>

      {errorMessage && (
        <p className="mt-3 text-xs text-rose-600 dark:text-rose-400 border-t border-neutral-100 dark:border-slate-800 pt-2.5">
          {errorMessage}
        </p>
      )}

      {voiceLog.length > 0 && (
        <ul
          aria-label="Dernières actions vocales"
          aria-live="polite"
          className="mt-3 border-t border-neutral-100 dark:border-slate-800 pt-2.5 space-y-1"
        >
          {voiceLog.map((entry) => (
            <li
              key={entry.key}
              className="text-xs text-slate-500 dark:text-slate-400 truncate"
              title={entry.text}
            >
              <span
                aria-hidden="true"
                className={entry.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
              >
                {entry.ok ? '✓' : '✕'}
              </span>{' '}
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
