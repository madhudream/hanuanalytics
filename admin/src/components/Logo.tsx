export function Logo({ size = 28 }: { size?: number }) {
  return <img src="/logo.svg" width={size} height={size} alt="" className="flex-none select-none" draggable={false} />;
}

export function Wordmark({ size = 28, text = true }: { size?: number; text?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Logo size={size} />
      {text && (
        <span className="text-[15.5px] font-semibold tracking-[-0.01em] text-t1">
          <span className="text-accent">Hanu</span>Analytics
        </span>
      )}
    </span>
  );
}
