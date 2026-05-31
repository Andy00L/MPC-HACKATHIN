/**
 * hooks/useVoice.ts
 * The keeper's voice. Plays /api/voice audio through ONE reused <audio> element. The
 * caller follows a render-first rule: it shows the text/chart first, THEN calls play(),
 * so audio is always a non-blocking extra layered over already-visible content.
 *
 * Handles: the browser autoplay policy (first play() must follow a user gesture — a
 * rejected play() sets a soft error, never crashes), rapid successive calls (stop +
 * revoke the previous clip before starting a new one), muting (skips the network call
 * entirely), and object-URL cleanup on end and on unmount (no leaks).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speak } from "@/lib/api/client";

export interface VoiceController {
  playing: boolean;
  muted: boolean;
  error: string | null;
  play: (text: string) => Promise<void>;
  stop: () => void;
  toggleMute: () => void;
}

export function useVoice(): VoiceController {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  // mutedRef mirrors `muted` so the stable play() callback always reads the latest value
  // without being recreated (which would churn callers' effect deps).
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Revoke the current object URL if any. Safe to call repeatedly.
  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // Lazily build the single Audio element. SSR-guarded (Audio is undefined on the server)
  // even though this hook only runs inside client components.
  const getAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === "undefined") return null;
    if (!audioRef.current) {
      const audio = new Audio();
      audio.addEventListener("ended", () => {
        setPlaying(false);
        revoke();
      });
      audio.addEventListener("error", () => setPlaying(false));
      audioRef.current = audio;
    }
    return audioRef.current;
  }, [revoke]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    revoke();
    setPlaying(false);
  }, [revoke]);

  const play = useCallback(
    async (text: string) => {
      // Muted (or empty line): skip the network call entirely — no cost, no audio.
      if (mutedRef.current || !text) return;
      const audio = getAudio();
      if (!audio) return;

      // Rapid successive calls: stop + revoke the previous clip before fetching the next.
      audio.pause();
      revoke();
      setError(null);

      const result = await speak(text);
      if (!result.ok) {
        // Soft error — the text/chart are already on screen; voice is optional.
        setError(result.error);
        return;
      }
      // If the user muted while the request was in flight, honour it and drop the clip.
      if (mutedRef.current) return;

      const url = URL.createObjectURL(result.data);
      urlRef.current = url;
      audio.src = url;
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        // Autoplay policy: a play() not tied to a user gesture rejects. Set a soft hint
        // and keep the UI fully usable — never crash.
        setError("Tap a control to let the keeper speak.");
        setPlaying(false);
      }
    },
    [getAudio, revoke],
  );

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (next) {
        // Muting: stop any current playback immediately.
        const audio = audioRef.current;
        if (audio) audio.pause();
        revoke();
        setPlaying(false);
      }
      return next;
    });
  }, [revoke]);

  // Cleanup on unmount: stop audio and revoke the URL so nothing leaks.
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) audio.pause();
      revoke();
    };
  }, [revoke]);

  return { playing, muted, error, play, stop, toggleMute };
}
