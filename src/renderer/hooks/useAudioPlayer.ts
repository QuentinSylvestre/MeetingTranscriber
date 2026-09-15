import { useRef, useState, useCallback } from 'react';

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);

  const seekTo = useCallback((ms: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = ms / 1000;
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else void audioRef.current.play();
  }, [playing]);

  const setPlaybackRate = useCallback((rate: number) => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = rate;
    setPlaybackRateState(rate);
  }, []);

  const onTimeUpdate = useCallback(() => {
    if (audioRef.current) setCurrentTimeMs(audioRef.current.currentTime * 1000);
  }, []);

  const onDurationChange = useCallback(() => {
    if (audioRef.current) {
      const d = audioRef.current.duration;
      // Guard against NaN (e.g. file not yet loadable) or Infinity
      setDuration(isFinite(d) ? d * 1000 : 0);
    }
  }, []);

  const onPlay = useCallback(() => setPlaying(true), []);
  const onPause = useCallback(() => setPlaying(false), []);
  const onError = useCallback(() => {
    const el = audioRef.current;
    const err = el?.error;
    const codes: Record<number, string> = {
      1: 'MEDIA_ERR_ABORTED',
      2: 'MEDIA_ERR_NETWORK',
      3: 'MEDIA_ERR_DECODE',
      4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
    };
    console.error('[AudioPlayer] error:', err ? `${codes[err.code] ?? err.code}: ${err.message}` : 'unknown', '| src:', el?.src);
  }, []);

  const onLoadStart = useCallback(() => {
    console.log('[AudioPlayer] loadstart src:', audioRef.current?.src);
  }, []);

  const onLoadedMetadata = useCallback(() => {
    console.log('[AudioPlayer] loadedmetadata duration:', audioRef.current?.duration);
  }, []);

  const onStalled = useCallback(() => {
    console.warn('[AudioPlayer] stalled src:', audioRef.current?.src);
  }, []);

  const onSuspend = useCallback(() => {
    console.log('[AudioPlayer] suspend (buffering paused) duration:', audioRef.current?.duration);
  }, []);

  return {
    audioRef, playing, currentTimeMs, duration, playbackRate,
    seekTo, togglePlay, setPlaybackRate,
    onTimeUpdate, onDurationChange, onPlay, onPause, onError,
    onLoadStart, onLoadedMetadata, onStalled, onSuspend,
  };
}
