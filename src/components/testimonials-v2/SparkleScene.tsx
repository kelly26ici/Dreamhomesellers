"use client";

/**
 * Deferred R3F gold-sparkle scene. Lives in its own module so consumers can
 * load it with next/dynamic({ ssr: false }) and keep three.js out of the
 * initial page bundle — the component tree is identical to the inline
 * <Canvas><Sparkles/></Canvas> block it replaced.
 */

import { Canvas } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";

export default function SparkleScene({
  scale = [24, 9, 2],
  size = 2.2,
  speed = 0.25,
  count = 130,
}: {
  readonly scale?: [number, number, number];
  readonly size?: number;
  readonly speed?: number;
  readonly count?: number;
}) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 10], fov: 60 }}
      gl={{ alpha: true, antialias: false }}
    >
      <Sparkles
        count={count}
        scale={scale}
        size={size}
        speed={speed}
        opacity={0.5}
        color="#d4a95f"
      />
    </Canvas>
  );
}
