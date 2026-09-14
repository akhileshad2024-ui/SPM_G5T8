export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      className="dot"
      style={{ width: size, height: size, background: color }}
    />
  );
}
