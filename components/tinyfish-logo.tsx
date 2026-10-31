/* eslint-disable @next/next/no-img-element -- small fixed-size logo */

// The TinyFish logo, from public/tinyfish.svg.
export default function TinyfishLogo({ size }: { size: number }) {
  return <img src="/tinyfish.svg" alt="TinyFish" width={size} height={size} style={{ display: "block" }} />;
}
