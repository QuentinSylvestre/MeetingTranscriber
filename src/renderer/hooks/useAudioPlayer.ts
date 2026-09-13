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
    if (audioRef.current) setDuration(audioRef.current.duration * 1000);
  }, []);

  const onPlay = useCallback(() => setPlaying(true), []);
  const onPause = useCallback(() => setPlaying(false), []);

  return {
    audioRef, playing, currentTimeMs, duration, playbackRate,
    seekTo, togglePlay, setPlaybackRate,
    onTimeUpdate, onDurationChange, onPlay, onPause,
  };
}
