import React, { useEffect, useRef, useState } from 'react';
import { PET_ANIMATIONS, type PetAnimation } from './petAnimations';
import { TAIL_OVERLAP_MS } from './petAnimationScheduler';

type PetVideoLayerProps = {
  activeAnimation: PetAnimation;
  onEnded: () => void;
};

const AUTOPLAY_RETRY_MS = 250;

function prepareAutoplayVideo(video: HTMLVideoElement) {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.controls = false;
  video.removeAttribute('controls');
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('autoplay', '');
}

export function PetVideoLayer({ activeAnimation, onEnded }: PetVideoLayerProps) {
  const videoRefs = useRef(new Map<PetAnimation['id'], HTMLVideoElement>());
  const onEndedRef = useRef(onEnded);
  const activeAnimationIdRef = useRef(activeAnimation.id);
  const previousAnimationRef = useRef<PetAnimation | null>(null);
  const playRetryTimersRef = useRef(new Map<PetAnimation['id'], number>());
  const [heldAnimationId, setHeldAnimationId] = useState<PetAnimation['id'] | null>(null);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const clearPlayRetry = (animationId: PetAnimation['id']) => {
    const timer = playRetryTimersRef.current.get(animationId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    playRetryTimersRef.current.delete(animationId);
  };

  function playAutoplayVideo(animationId: PetAnimation['id'], video: HTMLVideoElement) {
    prepareAutoplayVideo(video);
    clearPlayRetry(animationId);

    const attempt = () => {
      if (activeAnimationIdRef.current !== animationId) return;

      prepareAutoplayVideo(video);
      void video.play().catch(() => {
        clearPlayRetry(animationId);
        playRetryTimersRef.current.set(animationId, window.setTimeout(attempt, AUTOPLAY_RETRY_MS));
      });
    };

    attempt();
  }

  useEffect(() => {
    return () => {
      for (const timer of playRetryTimersRef.current.values()) window.clearTimeout(timer);
      playRetryTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    activeAnimationIdRef.current = activeAnimation.id;
    const previousAnimation = previousAnimationRef.current;
    const heldId = previousAnimation && previousAnimation.id !== activeAnimation.id ? previousAnimation.id : null;
    previousAnimationRef.current = activeAnimation;
    setHeldAnimationId(heldId);

    for (const animation of PET_ANIMATIONS) {
      const video = videoRefs.current.get(animation.id);
      if (!video) continue;

      prepareAutoplayVideo(video);
      if (animation.id === activeAnimation.id) {
        video.currentTime = 0;
        playAutoplayVideo(animation.id, video);
      } else if (animation.id !== heldId) {
        clearPlayRetry(animation.id);
        video.pause();
        video.currentTime = 0;
      }
    }

    if (!heldId) return undefined;

    const cleanupTimer = window.setTimeout(() => {
      const heldVideo = videoRefs.current.get(heldId);
      clearPlayRetry(heldId);
      heldVideo?.pause();
      if (heldVideo) heldVideo.currentTime = 0;
      setHeldAnimationId(null);
    }, TAIL_OVERLAP_MS);

    return () => window.clearTimeout(cleanupTimer);
  }, [activeAnimation.id]);

  const classNameFor = (animation: PetAnimation) => {
    if (animation.id === activeAnimation.id) return 'pet-video active';
    if (animation.id === heldAnimationId) return 'pet-video hold';
    return 'pet-video';
  };

  return (
    <div className="pet-video-stack" aria-label={activeAnimation.label}>
      {PET_ANIMATIONS.map((animation) => (
        <video
          key={animation.id}
          ref={(element) => {
            if (element) {
              prepareAutoplayVideo(element);
              videoRefs.current.set(animation.id, element);
              if (animation.id === activeAnimation.id) playAutoplayVideo(animation.id, element);
            } else {
              clearPlayRetry(animation.id);
              videoRefs.current.delete(animation.id);
            }
          }}
          className={classNameFor(animation)}
          src={animation.src}
          autoPlay={animation.id === activeAnimation.id}
          loop={animation.loop}
          muted
          playsInline
          controls={false}
          disablePictureInPicture
          controlsList="nodownload nofullscreen noremoteplayback"
          preload="auto"
          draggable={false}
          onLoadedData={(event) => {
            if (animation.id === activeAnimation.id) playAutoplayVideo(animation.id, event.currentTarget);
          }}
          onCanPlay={(event) => {
            if (animation.id === activeAnimation.id) playAutoplayVideo(animation.id, event.currentTarget);
          }}
          onPlay={() => clearPlayRetry(animation.id)}
          onEnded={() => {
            if (animation.id === activeAnimation.id) onEndedRef.current();
          }}
        />
      ))}
    </div>
  );
}
