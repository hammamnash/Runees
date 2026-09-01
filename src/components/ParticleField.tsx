"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient Particle Field — Dala signature visual.
 * Tiny outlined triangular glyphs in vivid chromatic colors drifting on the
 * black void. Fixed to the viewport background, pointer-events none.
 */
const COLORS = [
  "#8052ff", // electric iris
  "#ffb829", // saffron spark
  "#15846e", // deep verdant
  "#b44dff", // magenta-violet
  "#4d7cff", // blue
  "#ff5c8a", // pink
];

interface Particle {
  x: number;
  y: number;
  size: number;
  rot: number;
  rotSpeed: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
}

export function ParticleField({ density = 0.00006 }: { density?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let particles: Particle[] = [];
    let w = 0;
    let h = 0;

    const spawn = (): Particle => ({
      x: Math.random() * w,
      y: Math.random() * h,
      size: 2 + Math.random() * 5,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.004,
      vx: (Math.random() - 0.5) * 0.12,
      vy: (Math.random() - 0.5) * 0.12,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 0.12 + Math.random() * 0.35,
    });

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(140, Math.max(40, Math.floor(w * h * density)));
      particles = Array.from({ length: count }, spawn);
    };

    const drawTriangle = (p: Particle) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.lineTo(p.size * 0.87, p.size * 0.5);
      ctx.lineTo(-p.size * 0.87, p.size * 0.5);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    };

    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        // wrap around edges
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;
        drawTriangle(p);
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    tick();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}
